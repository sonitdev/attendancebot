import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceService } from '../src/attendance/attendance.service.js';
import { readAttendanceReplay, readOpenAttendance } from '../src/attendance/worker-read-model.js';
import { writeAttendance } from '../src/attendance/attendance-write-model.js';
import type { WorkerPrincipal } from '../src/auth/principal.js';
vi.mock('../src/attendance/worker-read-model.js', () => ({ readAttendanceReplay: vi.fn(), readOpenAttendance: vi.fn() }));
vi.mock('../src/attendance/attendance-write-model.js', () => ({ writeAttendance: vi.fn() }));

describe('check-out orchestration', () => {
  const worker: WorkerPrincipal = { type: 'worker', organizationId: 'org', employeeId: 'worker', telegramUserId: 'tg', sessionId: 'session' };
  const input = { latitude: 11.5564, longitude: 104.9282, accuracyMeters: 10 };
  let service: AttendanceService; let open: any;
  const authorize = vi.fn(); const dispatch = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    open = {
      id: 'record', organizationId: 'org', employeeId: 'worker', projectId: 'project', telegramChatId: '-100',
      checkInAt: new Date(Date.now() - 8 * 3_600_000), employeeFullName: 'Dara', connection: null,
      project: { id: 'project', organizationId: 'org', name: 'Project', status: 'ACTIVE', workMode: 'SITE', telegramChatId: '-100' },
      assignment: { site: { id: 'site', name: 'Site', ...input, allowedRadiusMeters: 100, timezone: 'Asia/Phnom_Penh' }, schedule: { endTime: '17:00' } },
    };
    vi.mocked(readAttendanceReplay).mockResolvedValue(null);
    vi.mocked(readOpenAttendance).mockImplementation(async () => open);
    vi.mocked(writeAttendance).mockImplementation(async (_db, value) => ({ record: { id: 'record', status: value.status } as any, deliveryIds: ['delivery'] }));
    authorize.mockResolvedValue({});
    service = new AttendanceService({} as any, {} as any, { dispatch } as any, { authorizeWorkerProject: authorize } as any, {} as any, {} as any);
  });
  it('calculates duration and queues a text notification in the original project', async () => {
    expect(await service.checkOut(worker, input, 'key')).toMatchObject({ action: 'CHECK_OUT', attendanceId: 'record', workDurationMinutes: 480, verificationResult: 'VERIFIED' });
    expect(writeAttendance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recordId: 'record', organizationId: 'org', employeeId: 'worker', projectId: 'project', deliveries: [expect.objectContaining({ kind: 'TEXT', chatId: '-100' })] }));
    expect(dispatch).toHaveBeenCalledWith('delivery', 'org');
  });
  it('rejects no open attendance without writes', async () => {
    open = null;
    await expect(service.checkOut(worker, input, 'key')).rejects.toThrow('NO_OPEN_ATTENDANCE');
    expect(writeAttendance).not.toHaveBeenCalled();
  });
  it('replays saved outcome without notifications', async () => {
    vi.mocked(readAttendanceReplay).mockResolvedValue({ id: 'saved', status: 'COMPLETED', timestamp: new Date(), verification: 'VERIFIED', distanceMeters: 0, workDurationMinutes: 480 });
    expect((await service.checkOut(worker, input, 'key')).attendanceId).toBe('saved');
    expect(writeAttendance).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });
  it('persists SALES followup without awaiting reports or Telegram', async () => {
    open.project.workMode = 'SALES'; dispatch.mockReturnValue(new Promise(() => {}));
    await service.checkOut(worker, input, 'key');
    expect(vi.mocked(writeAttendance).mock.calls[0][1].deliveries).toEqual([
      expect.objectContaining({ kind: 'TEXT' }), expect.objectContaining({ kind: 'SALES_REPORT', chatId: 'tg' }),
    ]);
  });
  it('does not overwrite a winning checkout', async () => {
    vi.mocked(writeAttendance).mockResolvedValue(null);
    await expect(service.checkOut(worker, input, 'other-key')).rejects.toThrow('ALREADY_CHECKED_OUT');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
