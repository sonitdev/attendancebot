import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramOutboxService } from '../src/jobs/telegram-outbox.service.js';
import { encodeSalesReportFollowup, enqueueSalesReportFollowup, prepareSalesReportFollowup } from '../src/sales/report-followup.js';

// Shared state models the atomic conditional update; separate service instances share no locks.
function fixture(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  const row: any = {
    id: 'delivery-1', organizationId: 'org-1', attendanceRecordId: 'attendance-1',
    attendanceRecord: { organizationId: 'org-1' }, kind: 'TEXT', chatId: '-1001', text: 'checkout',
    status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: now, updatedAt: now, createdAt: now,
    ...overrides,
  };
  function matches(value: any, where: any): boolean {
    return Object.entries(where).every(([key, expected]: [string, any]) => {
      if (key === 'OR') return expected.some((condition: any) => matches(value, condition));
      const actual = value[key];
      if (expected instanceof Date) return actual?.getTime() === expected.getTime();
      if (expected && typeof expected === 'object') {
        if ('in' in expected) return expected.in.includes(actual);
        if ('lt' in expected) return actual < expected.lt;
        if ('lte' in expected) return actual <= expected.lte;
        return matches(actual, expected);
      }
      return actual === expected;
    });
  }
  const prisma: any = {
    telegramDelivery: {
      updateMany: vi.fn(async ({ where, data }) => {
        if (!matches(row, where)) return { count: 0 };
        for (const [key, value] of Object.entries(data) as [string, any][]) {
          row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
        }
        row.updatedAt = new Date();
        return { count: 1 };
      }),
      findFirst: vi.fn(async ({ where }) => matches(row, where) ? { ...row } : null),
      findMany: vi.fn(async ({ where }) => matches(row, where) ? [{ ...row }] : []),
    },
    attendanceRecord: { findFirst: vi.fn(async () => ({ id: 'attendance-1', projectId: 'project-1', attendanceDate: new Date('2026-10-02') })) },
    dailySalesReport: { upsert: vi.fn(async () => ({ id: 'report-1' })) },
    visitLog: { findMany: vi.fn(async () => [{ id: 'visit-1' }, { id: 'visit-2' }]) },
    dailySalesReportVisit: { createMany: vi.fn(async () => ({ count: 2 })) },
    telegramAccount: { findFirst: vi.fn(async () => ({ id: 'account-1' })) },
  };
  prisma.$transaction = vi.fn(async (callback) => callback(prisma));
  const notifier: any = { sendMessage: vi.fn(async () => ({ success: true, messageId: 88 })), sendPhoto: vi.fn() };
  return { row, prisma, notifier, service: new TelegramOutboxService(prisma, notifier) };
}

describe('durable Telegram dispatch', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T10:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('allows one send across concurrent independent workers', async () => {
    const { prisma, notifier, service, row } = fixture();
    const second = new TelegramOutboxService(prisma, notifier);
    expect(await Promise.all([service.processDeliveryById(row.id, row.organizationId), second.processDeliveryById(row.id, row.organizationId)])).toEqual([true, false]);
    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('SENT');
    expect(await second.processDeliveryById(row.id, row.organizationId)).toBe(false);
  });

  it('fails closed on missing organization and rejects foreign organization or attendance relation', async () => {
    const { service, row, notifier } = fixture();
    expect(await service.processDeliveryById(row.id, '')).toBe(false);
    expect(await service.processDeliveryById(row.id, 'org-2')).toBe(false);
    row.attendanceRecord.organizationId = 'org-2';
    expect(await service.processDeliveryById(row.id, 'org-1')).toBe(false);
    expect(row.attempts).toBe(0);
    expect(notifier.sendMessage).not.toHaveBeenCalled();
  });

  it('honors database backoff even for a duplicated/early queue job', async () => {
    const { service, row, notifier } = fixture();
    notifier.sendMessage.mockResolvedValueOnce({ success: false, retryable: true, uncertain: false, error: 'TELEGRAM_REJECTED_429', retryAfterMs: 120_000 });
    expect(await service.processDeliveryById(row.id, row.organizationId)).toBe(false);
    expect(row.nextAttemptAt.getTime()).toBe(Date.now() + 120_000);
    expect(await service.processDeliveryById(row.id, row.organizationId)).toBe(false);
    vi.advanceTimersByTime(120_000);
    expect(await service.processPending()).toBe(1);
    expect(row.attempts).toBe(2);
  });

  it('holds uncertain sends and legacy failures instead of retrying them', async () => {
    const { service, row, notifier } = fixture();
    notifier.sendMessage.mockResolvedValueOnce({ success: false, uncertain: true, error: 'TELEGRAM_OUTCOME_UNKNOWN' });
    await service.processDeliveryById(row.id, row.organizationId);
    vi.advanceTimersByTime(600_000);
    expect(await service.processPending()).toBe(0);
    expect(row).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'TELEGRAM_OUTCOME_UNKNOWN' });
    row.attempts = 1;
    row.lastError = 'fetch failed'; // An older worker did not classify this outcome.
    expect(await service.processDeliveryById(row.id, row.organizationId)).toBe(false);
    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('recovers a committed pending row after a process restart without Redis', async () => {
    const { prisma, notifier, row } = fixture();
    const restarted = new TelegramOutboxService(prisma, notifier);
    expect(await restarted.processPending()).toBe(1);
    expect(row.status).toBe('SENT');
  });

  it('replays stale preparation but holds stale network or unmarked legacy claims', async () => {
    for (const marker of ['CLAIMED:previous-worker', 'SENDING:previous-worker', null]) {
      const { service, row, notifier } = fixture({ status: 'PROCESSING', attempts: 1, lastError: marker, updatedAt: new Date(Date.now() - 301_000) });
      await service.processPending();
      expect(notifier.sendMessage).toHaveBeenCalledTimes(marker?.startsWith('CLAIMED:') ? 1 : 0);
      expect(row.status).toBe(marker?.startsWith('CLAIMED:') ? 'SENT' : 'FAILED');
    }
  });

  it('does not resend when Telegram accepted but persisting SENT failed', async () => {
    const { service, row, prisma, notifier } = fixture();
    const update = prisma.telegramDelivery.updateMany.getMockImplementation();
    prisma.telegramDelivery.updateMany.mockImplementation(async (args) => {
      if (args.data.status === 'SENT') throw new Error('database unavailable');
      return update(args);
    });
    expect(await service.processDeliveryById(row.id, row.organizationId)).toBe(false);
    vi.advanceTimersByTime(600_000);
    await new TelegramOutboxService(prisma, notifier).processPending();
    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
    expect(row.lastError).toBe('TELEGRAM_OUTCOME_UNKNOWN');
  });

  it('fences a worker that resumes after its preparation lease was reclaimed', async () => {
    const { service, row, prisma, notifier } = fixture();
    const read = prisma.telegramDelivery.findFirst.getMockImplementation();
    prisma.telegramDelivery.findFirst.mockImplementation(async (args) => {
      row.lastError = 'CLAIMED:new-worker';
      row.attempts += 1;
      return read(args);
    });
    expect(await service.processDeliveryById(row.id, row.organizationId)).toBe(false);
    expect(notifier.sendMessage).not.toHaveBeenCalled();
    expect(row.lastError).toBe('CLAIMED:new-worker');
  });

  it('returns immediately from dispatch and falls back to scanning when Redis rejects', async () => {
    const { prisma, notifier, row } = fixture();
    const queue: any = { enqueue: vi.fn().mockRejectedValue(new Error('Redis offline')) };
    const service = new TelegramOutboxService(prisma, notifier, queue);
    expect(service.dispatch(row.id, row.organizationId)).toBeUndefined();
    expect(notifier.sendMessage).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(row.status).toBe('SENT');
  });

  it('catches database failures during scan and dispatch, and coalesces overlapping scans', async () => {
    const { service, prisma, row } = fixture();
    prisma.telegramDelivery.findMany.mockRejectedValue(new Error('offline'));
    const scan = service.processPending();
    expect(service.processPending()).toBe(scan);
    await expect(scan).resolves.toBe(0);
    service.dispatch(row.id, row.organizationId);
    await vi.runAllTimersAsync();
  });

  it('uses the queue when available without sending in the request callback', async () => {
    const { prisma, notifier, row } = fixture();
    const queue: any = { enqueue: vi.fn().mockResolvedValue(true) };
    const service = new TelegramOutboxService(prisma, notifier, queue);
    service.dispatch(row.id, row.organizationId);
    await vi.runAllTimersAsync();
    expect(queue.enqueue).toHaveBeenCalledWith({ id: row.id, organizationId: row.organizationId });
    expect(notifier.sendMessage).not.toHaveBeenCalled();
    expect(row.status).toBe('PENDING');
  });
});

describe('durable SALES_REPORT followup', () => {
  const payload = { employeeId: 'employee-1', telegramUserId: 'telegram-1' };
  const salesFixture = () => fixture({ kind: 'SALES_REPORT', chatId: 'telegram-1', text: encodeSalesReportFollowup(payload) });

  it('prepares the draft and visit links and checkpoints the report before notifying the worker', async () => {
    const { service, prisma, row, notifier } = salesFixture();
    notifier.sendMessage.mockImplementation(async (_chat, _text, _mode, markup) => {
      expect(row.text).toContain('report-1');
      expect(row.lastError).toMatch(/^SENDING:/);
      expect(markup.inline_keyboard[0][0].callback_data).toBe('sales_report:report-1');
      return { success: true, messageId: 99 };
    });
    expect(await service.processDeliveryById(row.id, row.organizationId)).toBe(true);
    expect(prisma.dailySalesReport.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { attendanceRecordId: 'attendance-1', organizationId: 'org-1', employeeId: 'employee-1' }, update: {},
    }));
    expect(prisma.dailySalesReportVisit.createMany).toHaveBeenCalledWith({
      data: [{ reportId: 'report-1', visitLogId: 'visit-1' }, { reportId: 'report-1', visitLogId: 'visit-2' }], skipDuplicates: true,
    });
    expect(prisma.attendanceRecord.create).toBeUndefined();
  });

  it('replays database preparation after restart without resetting draft/submitted report contents', async () => {
    const { prisma, notifier, row } = salesFixture();
    await prepareSalesReportFollowup(prisma, row.organizationId, row.attendanceRecordId, payload);
    row.status = 'PROCESSING'; row.attempts = 1; row.lastError = 'CLAIMED:crashed'; row.updatedAt = new Date(Date.now() - 301_000);
    await new TelegramOutboxService(prisma, notifier).processPending();
    expect(prisma.dailySalesReport.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.dailySalesReport.upsert.mock.calls.every(([args]) => Object.keys(args.update).length === 0)).toBe(true);
    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not notify for mismatched payload, attendance scope, or inactive Telegram recipient', async () => {
    for (const failure of ['payload', 'attendance', 'recipient']) {
      const { prisma, notifier, row, service } = salesFixture();
      if (failure === 'payload') row.chatId = 'different-person';
      if (failure === 'attendance') prisma.attendanceRecord.findFirst.mockResolvedValue(null);
      if (failure === 'recipient') prisma.telegramAccount.findFirst.mockResolvedValue(null);
      expect(await service.processDeliveryById(row.id, row.organizationId)).toBe(false);
      expect(notifier.sendMessage).not.toHaveBeenCalled();
      expect(row.attempts).toBe(5);
    }
  });

  it('uses the separate enum slot and validates payloads before inserting', async () => {
    const tx: any = { telegramDelivery: { upsert: vi.fn(async ({ create }) => ({ ...create, id: 'sales-delivery' })) } };
    const input = { ...payload, organizationId: 'org-1', attendanceRecordId: 'attendance-1' };
    await enqueueSalesReportFollowup(tx, input);
    expect(tx.telegramDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { attendanceRecordId_kind: { attendanceRecordId: 'attendance-1', kind: 'SALES_REPORT' }, organizationId: 'org-1' },
    }));
    await expect(enqueueSalesReportFollowup(tx, { ...input, telegramUserId: '' })).rejects.toThrow();
    expect(tx.telegramDelivery.upsert).toHaveBeenCalledTimes(1);
  });
});
