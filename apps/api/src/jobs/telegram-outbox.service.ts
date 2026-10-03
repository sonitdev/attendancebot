import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { Prisma, TelegramDelivery } from '@prisma/client';
import { km } from '@workforce/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { decodeSalesReportFollowup, encodeSalesReportFollowup, prepareSalesReportFollowup } from '../sales/report-followup.js';
import { TelegramNotifierService, type TelegramSendResult } from './telegram-notifier.service.js';
import { TelegramDispatchQueueService } from './telegram-dispatch-queue.service.js';
import { timeBackgroundStep, timeStep } from '../common/performance/request-timing.js';

const MAX_ATTEMPTS = 5;
const PROCESSING_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 30_000;
const SAFE_RETRY_ERRORS = [
  'EVIDENCE_FETCH_FAILED', 'TELEGRAM_NOT_CONFIGURED', 'TELEGRAM_OR_STORAGE_NOT_CONFIGURED',
  'TELEGRAM_REJECTED_429', 'PREPARATION_INTERRUPTED', 'PREPARATION_FAILED',
];

function due(now: Date): Prisma.TelegramDeliveryWhereInput {
  return {
    attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now },
    OR: [{ status: 'PENDING' }, { status: 'FAILED', lastError: { in: SAFE_RETRY_ERRORS } }],
  };
}

@Injectable()
export class TelegramOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramOutboxService.name);
  private timer?: NodeJS.Timeout;
  private scanning?: Promise<number>;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: TelegramNotifierService,
    @Optional() private readonly queue?: TelegramDispatchQueueService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.queue?.start((id, organizationId) => this.processDeliveryById(id, organizationId));
    void this.processPending();
    this.timer = setInterval(() => void this.processPending(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Post-commit hint only. The committed database row, not this callback or Redis, guarantees recovery. */
  dispatch(id: string, organizationId: string): void {
    if (!id || !organizationId || this.stopped) return;
    setImmediate(() => {
      if (this.stopped) return;
      void this.enqueueOrScan(id, organizationId).catch(() => {
        this.logger.warn('Telegram dispatch deferred to the durable outbox scan.');
      });
    });
  }

  scheduleDelivery(id: string, organizationId: string): void { this.dispatch(id, organizationId); }

  private async enqueueOrScan(id: string, organizationId: string): Promise<void> {
    try {
      if (await this.queue?.enqueue({ id, organizationId })) return;
    } catch { /* The scanner also handles adapters that fail unexpectedly. */ }
    await this.processPending();
  }

  processPending(limit = 20): Promise<number> {
    if (this.stopped) return Promise.resolve(0);
    if (this.scanning) return this.scanning;
    this.scanning = this.scan(Math.max(1, Math.min(100, Math.floor(limit) || 20)))
      .catch(() => {
        this.logger.warn('Telegram outbox scan failed; it will retry on the next interval.');
        return 0;
      }).finally(() => { this.scanning = undefined; });
    return this.scanning;
  }

  private async scan(limit: number): Promise<number> {
    const now = new Date();
    // System scheduler discovers IDs across tenants. All claims, payload reads and mutations are tenant-scoped.
    const stale = await this.prisma.telegramDelivery.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: new Date(now.getTime() - PROCESSING_TIMEOUT_MS) } },
      select: { id: true, organizationId: true, attempts: true, lastError: true, updatedAt: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: limit,
    });
    for (const row of stale) {
      const safeToRetry = row.lastError?.startsWith('CLAIMED:') === true;
      await this.prisma.telegramDelivery.updateMany({
        where: { id: row.id, organizationId: row.organizationId, status: 'PROCESSING', updatedAt: row.updatedAt, attempts: row.attempts, lastError: row.lastError },
        data: {
          status: 'FAILED', nextAttemptAt: now,
          lastError: safeToRetry ? 'PREPARATION_INTERRUPTED' : 'TELEGRAM_OUTCOME_UNKNOWN',
          ...(!safeToRetry ? { attempts: MAX_ATTEMPTS } : {}),
        },
      });
    }
    const deliveries = await this.prisma.telegramDelivery.findMany({
      where: due(now), select: { id: true, organizationId: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: limit,
    });
    let sent = 0;
    for (let index = 0; index < deliveries.length; index += 4) {
      const results = await Promise.all(deliveries.slice(index, index + 4).map(async (delivery) => {
        try {
          if (await this.queue?.enqueue(delivery)) return false;
        } catch { /* Redis is optional. */ }
        return this.processDeliveryById(delivery.id, delivery.organizationId);
      }));
      sent += results.filter(Boolean).length;
    }
    return sent;
  }

  async processDeliveryById(id: string, organizationId: string): Promise<boolean> {
    return timeBackgroundStep('telegram_outbox', () => this.processClaimedDelivery(id, organizationId));
  }

  private async processClaimedDelivery(id: string, organizationId: string): Promise<boolean> {
    if (!id || !organizationId || this.stopped) return false;
    const token = randomUUID();
    let marker = `CLAIMED:${token}`;
    let delivery: TelegramDelivery | null = null;
    const ownership = (): Prisma.TelegramDeliveryWhereInput => ({
      id, organizationId, status: 'PROCESSING', lastError: marker,
      ...(delivery ? { attempts: delivery.attempts } : {}),
    });
    try {
      const claim = await this.prisma.telegramDelivery.updateMany({
        where: { id, organizationId, attendanceRecord: { organizationId }, ...due(new Date()) },
        data: { status: 'PROCESSING', attempts: { increment: 1 }, lastError: marker },
      });
      if (claim.count !== 1) return false;
      delivery = await this.prisma.telegramDelivery.findFirst({
        where: { ...ownership(), attendanceRecord: { organizationId } },
      });
      if (!delivery) return false;

      let send: () => Promise<TelegramSendResult>;
      if (delivery.kind === 'SALES_REPORT') {
        const task = decodeSalesReportFollowup(delivery.text);
        if (!task || task.telegramUserId !== delivery.chatId) throw new Error('SALES_FOLLOWUP_PAYLOAD_INVALID');
        const report = await timeStep('report_generation', () => this.prisma.$transaction((tx) => prepareSalesReportFollowup(tx, organizationId, delivery!.attendanceRecordId, task)));
        // Recheck the persisted link before delivering a private notification. No expired worker session is reconstructed.
        const account = await this.prisma.telegramAccount.findFirst({
          where: { organizationId, employeeId: task.employeeId, telegramUserId: task.telegramUserId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!account) throw new Error('SALES_FOLLOWUP_RECIPIENT_INVALID');
        const checkpoint = await this.prisma.telegramDelivery.updateMany({
          where: ownership(), data: { text: encodeSalesReportFollowup({ ...task, reportId: report.id }) },
        });
        if (checkpoint.count !== 1) return false;
        send = () => this.notifier.sendMessage(task.telegramUserId, km.telegram.salesReportReady, 'Markdown', {
          inline_keyboard: [[{ text: km.telegram.openSalesReport, callback_data: `sales_report:${report.id}` }]],
        });
      } else if (delivery.kind === 'PHOTO' && delivery.storagePath) {
        send = () => this.notifier.sendPhoto(delivery!.chatId, delivery!.storagePath!, delivery!.text);
      } else if (delivery.kind === 'TEXT') {
        send = () => this.notifier.sendMessage(delivery!.chatId, delivery!.text);
      } else {
        throw new Error('DELIVERY_PAYLOAD_INVALID');
      }

      // Persist the uncertainty boundary BEFORE the non-idempotent network call.
      const sendingMarker = `SENDING:${token}`;
      const sending = await this.prisma.telegramDelivery.updateMany({ where: ownership(), data: { lastError: sendingMarker } });
      if (sending.count !== 1) return false;
      marker = sendingMarker;
      const result = await timeStep('telegram', send);
      if (result.success) {
        const completed = await this.prisma.telegramDelivery.updateMany({
          where: ownership(),
          data: { status: 'SENT', sentAt: new Date(), telegramMessageId: result.messageId ? String(result.messageId) : null, lastError: null },
        });
        return completed.count === 1;
      }
      const retryable = result.retryable === true && result.uncertain !== true && SAFE_RETRY_ERRORS.includes(result.error ?? '');
      const uncertain = result.uncertain === true || (result.retryable === undefined && result.uncertain === undefined);
      const delayMs = Math.max(result.retryAfterMs ?? 0, Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, delivery.attempts - 1)));
      await this.prisma.telegramDelivery.updateMany({
        where: ownership(),
        data: {
          status: 'FAILED', nextAttemptAt: new Date(Date.now() + delayMs),
          lastError: uncertain ? 'TELEGRAM_OUTCOME_UNKNOWN' : (result.error ?? 'TELEGRAM_REJECTED').slice(0, 100),
          ...(!retryable ? { attempts: MAX_ATTEMPTS } : {}),
        },
      });
      return false;
    } catch (error) {
      // If persisting a success fails, the send may still have succeeded. Never turn that into a retry.
      const uncertain = marker.startsWith('SENDING:');
      const invalid = error instanceof Error && /^(SALES_FOLLOWUP_.*INVALID|DELIVERY_PAYLOAD_INVALID)$/.test(error.message);
      try {
        await this.prisma.telegramDelivery.updateMany({
          where: ownership(),
          data: {
            status: 'FAILED', nextAttemptAt: new Date(Date.now() + 30_000),
            lastError: uncertain ? 'TELEGRAM_OUTCOME_UNKNOWN' : invalid ? 'DELIVERY_PAYLOAD_INVALID' : 'PREPARATION_FAILED',
            ...(uncertain || invalid ? { attempts: MAX_ATTEMPTS } : {}),
          },
        });
      } catch { /* A surviving PROCESSING marker is handled by restart recovery. */ }
      this.logger.warn('Telegram delivery deferred or held for review; attendance is unchanged.');
      return false;
    }
  }
}
