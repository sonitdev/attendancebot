import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceActionResponse, TelegramSessionResponse, WorkerTodayResponse } from '@workforce/contracts';
import { AttendanceSubmission, applyAttendanceResult, hasSavedAttendance, notifyAttendanceHaptic } from '../../telegram-mini-app/src/lib/attendance-submission';
import { api, ApiError } from '../../telegram-mini-app/src/lib/api';
import { readWorkerCache, writeWorkerToday } from '../../telegram-mini-app/src/lib/worker-cache';

const today = {
  date: '2026-10-02', currentProject: { id: 'project' }, assignment: { id: 'assignment' },
  site: { name: 'Test site', timezone: 'Asia/Phnom_Penh' }, attendance: null,
} as WorkerTodayResponse;
const checkIn: AttendanceActionResponse = {
  attendanceId: 'record', action: 'CHECK_IN', status: 'ON_TIME', verificationResult: 'VERIFIED',
  timestamp: '2026-10-02T01:00:00.000Z', workDurationMinutes: null, distanceMeters: 0, message: 'saved',
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Mini App authoritative submission feedback', () => {
  it('applies check-in and checkout immediately using server timestamps', () => {
    const checkedIn = applyAttendanceResult(today, checkIn);
    expect(checkedIn.attendance?.checkInAt).toBe(checkIn.timestamp);
    const checkedOut = applyAttendanceResult(checkedIn, { ...checkIn, action: 'CHECK_OUT', status: 'COMPLETED', timestamp: '2026-10-02T10:00:00.000Z', workDurationMinutes: 540 });
    expect(checkedOut.attendance).toMatchObject({ checkInAt: checkIn.timestamp, checkOutAt: '2026-10-02T10:00:00.000Z', workDurationMinutes: 540 });
    expect(hasSavedAttendance(today, checkedIn, 'CHECK_IN')).toBe(true);
    expect(hasSavedAttendance(checkedIn, checkedIn, 'CHECK_IN')).toBe(false);
    expect(hasSavedAttendance(checkedIn, checkedOut, 'CHECK_OUT')).toBe(true);
    expect(hasSavedAttendance(today, { ...checkedIn, date: '2026-10-03' }, 'CHECK_IN')).toBe(false);
  });

  it('does not mistake an unavailable haptic bridge for a failed save', () => {
    vi.stubGlobal('window', { Telegram: { WebApp: { HapticFeedback: { notificationOccurred: () => { throw new Error('unsupported'); } } } } });
    expect(() => notifyAttendanceHaptic('VERIFIED')).not.toThrow();
  });

  it('reuses the same key and original payload after timeout; next successful action gets a new key', async () => {
    const submission = new AttendanceSubmission();
    const send = vi.fn().mockRejectedValueOnce(new ApiError('timeout', 408, 'TIMEOUT')).mockResolvedValue(checkIn);
    await expect(submission.submit('worker:project:date:CHECK_IN', send)).rejects.toThrow('timeout');
    const replacementPayload = vi.fn();
    await expect(submission.submit('worker:project:date:CHECK_IN', replacementPayload)).resolves.toEqual(checkIn);
    expect(replacementPayload).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0]).toBe(send.mock.calls[1][0]);
    await submission.submit('worker:project:date:CHECK_IN', send);
    expect(send.mock.calls[2][0]).not.toBe(send.mock.calls[0][0]);
  });

  it('coalesces rapid duplicate actions and clears definitive validation failures', async () => {
    const submission = new AttendanceSubmission();
    const send = vi.fn().mockRejectedValue(new ApiError('invalid', 400));
    const first = submission.submit('scope', send);
    expect(submission.submit('scope', send)).toBe(first);
    await expect(first).rejects.toThrow('invalid');
    await expect(submission.submit('scope', send)).rejects.toThrow('invalid');
    expect(send.mock.calls[0][0]).not.toBe(send.mock.calls[1][0]);
  });
});

describe('Mini App request transport', () => {
  it('deduplicates simultaneous reads but invalidates pre-write reads after a mutation', async () => {
    let finishOld!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(Response.json(checkIn)).mockResolvedValueOnce(Response.json({ fresh: true }));
    vi.stubGlobal('fetch', fetchMock);
    const old = api.getToday('transport-test');
    const same = api.getToday('transport-test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await api.checkOut('transport-test', {} as never, 'key');
    const fresh = api.getToday('transport-test');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    finishOld(Response.json({ fresh: false }));
    await Promise.all([old, same]);
    await expect(fresh).resolves.toEqual({ fresh: true });
  });

  it('keeps its 20-second timeout running while reading the response body', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    })));
    const result = expect(api.getToday('timeout-test')).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20_000);
    await result;
  });

  it('rejects an HTML tunnel error or malformed success body rather than treating it as attendance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>offline</html>', { status: 200 })));
    await expect(api.getToday('html-test')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('Mini App cached preview isolation', () => {
  it('rejects a different worker, expired preview, and previous site day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T01:01:00Z'));
    const items = new Map<string, string>();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', { setItem: (k: string, v: string) => items.set(k, v), getItem: (k: string) => items.get(k) ?? null, removeItem: (k: string) => items.delete(k) });
    const session = { employee: { id: 'worker' }, organization: { id: 'org' }, expiresAt: '2026-10-03T00:00:00Z' } as TelegramSessionResponse;
    const preview = { ...today, currentProject: { ...today.currentProject, name: 'Test project' } };
    writeWorkerToday(preview, session);
    expect(readWorkerCache(session).today).toEqual(preview);
    expect(readWorkerCache({ ...session, employee: { ...session.employee, id: 'other' } }).today).toBeNull();
    writeWorkerToday(preview, session);
    vi.advanceTimersByTime(60_001);
    expect(readWorkerCache(session).today).toBeNull();
    writeWorkerToday({ ...preview, date: '2026-10-01' }, session);
    expect(readWorkerCache(session).today).toBeNull();
  });
});
