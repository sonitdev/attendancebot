import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceService } from '../src/attendance/attendance.service.js';
import { readAttendanceReplay, readWorkerAssignments } from '../src/attendance/worker-read-model.js';
import { writeAttendance } from '../src/attendance/attendance-write-model.js';
import type { WorkerPrincipal } from '../src/auth/principal.js';

vi.mock('../src/attendance/worker-read-model.js', () => ({ readAttendanceReplay: vi.fn(), readWorkerAssignments: vi.fn() }));
vi.mock('../src/attendance/attendance-write-model.js', () => ({ writeAttendance: vi.fn() }));

describe('check-in orchestration; SQL constraints covered by write-model integration tests', () => {
  const worker: WorkerPrincipal = { type: 'worker', organizationId: 'org', employeeId: 'worker', telegramUserId: 'tg', sessionId: 'session' };
  const input = { latitude: 11.5564, longitude: 104.9282, accuracyMeters: 10, proofPhotoDataUrl: 'data:image/jpeg;base64,AA==' };
  const row = {
    id: 'assignment', startsOn: new Date('2020-01-01'), endsOn: null,
    currentProject: { id: 'project', organizationId: 'org', name: 'Project', status: 'ACTIVE', workMode: 'SITE' as const, telegramChatId: '-100', employeeFullName: 'Dara' },
    connection: { id: 'connection', organizationId: 'org', employeeId: 'worker', projectId: 'project' },
    site: { id: 'site', name: 'Site', projectId: 'project', latitude: 11.5564, longitude: 104.9282, allowedRadiusMeters: 100, timezone: 'Asia/Phnom_Penh' },
    schedule: { id: 'schedule', name: 'Shift', startTime: '08:00', endTime: '17:00', graceMinutes: 15 },
    attendance: null,
  };
  let service: AttendanceService;
  let photo: ReturnType<typeof vi.spyOn>;
  const authorize = vi.fn(); const dispatch = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readAttendanceReplay).mockResolvedValue(null);
    vi.mocked(readWorkerAssignments).mockResolvedValue([row]);
    vi.mocked(writeAttendance).mockImplementation(async (_db, value) => ({ record: { id: 'record', status: value.status } as any, deliveryIds: ['delivery'] }));
    authorize.mockResolvedValue({});
    service = new AttendanceService({} as any, {} as any, { dispatch } as any, { authorizeWorkerProject: authorize } as any, {} as any, {} as any);
    photo = vi.spyOn(service as any, 'storeCheckInPhoto').mockResolvedValue('org/worker/photo.jpg');
  });

  it('saves scoped attendance and photo intent without awaiting Telegram delivery', async () => {
    dispatch.mockReturnValue(new Promise(() => {}));
    const result = await service.checkIn(worker, input, 'key');
    expect(result).toMatchObject({ attendanceId: 'record', action: 'CHECK_IN', verificationResult: 'VERIFIED' });
    expect(writeAttendance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      organizationId: 'org', employeeId: 'worker', projectId: 'project', assignmentId: 'assignment', siteId: 'site', idempotencyKey: 'key',
      deliveries: [expect.objectContaining({ kind: 'PHOTO', chatId: '-100', storagePath: 'org/worker/photo.jpg' })],
    }));
    expect(authorize).toHaveBeenCalledWith(worker, 'project', 'CHECK_IN', true, expect.objectContaining({ connection: row.connection }));
    expect(dispatch).toHaveBeenCalledWith('delivery', 'org');
  });
  it.each([
    [{ ...input, latitude: 11.57 }, 'OUTSIDE_GEOFENCE'],
    [{ ...input, accuracyMeters: 101 }, 'LOW_ACCURACY'],
  ])('preserves server GPS verification for %j', async (location, expected) => {
    expect((await service.checkIn(worker, location, 'key')).verificationResult).toBe(expected);
    expect(vi.mocked(writeAttendance).mock.calls[0][1].verification).toBe(expected);
  });
  it('replays saved outcome without photo or repeated writes', async () => {
    vi.mocked(readAttendanceReplay).mockResolvedValue({ id: 'saved', status: 'ON_TIME', verification: 'VERIFIED', timestamp: new Date('2026-10-02T01:00Z'), distanceMeters: 0, workDurationMinutes: null });
    expect((await service.checkIn(worker, { ...input, proofPhotoDataUrl: undefined }, 'retry')).attendanceId).toBe('saved');
    expect(readAttendanceReplay).toHaveBeenCalledWith(expect.anything(), worker, 'CHECK_IN', 'retry');
    expect(photo).not.toHaveBeenCalled(); expect(writeAttendance).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });
  it('rejects duplicate daily check-in before uploading another photo', async () => {
    vi.mocked(readWorkerAssignments).mockResolvedValue([{ ...row, attendance: { id: 'saved', checkInAt: new Date(), checkOutAt: null, status: 'ON_TIME', verification: 'VERIFIED', workDurationMinutes: null } }]);
    await expect(service.checkIn(worker, input, 'other-key')).rejects.toThrow('ALREADY_CHECKED_IN');
    expect(photo).not.toHaveBeenCalled();
  });
  it.each([{ code: 'P2002' }, { code: 'P2010', meta: { code: '23505' } }])('handles a lost uniqueness race %j', async (error) => {
    vi.mocked(writeAttendance).mockRejectedValue(error);
    await expect(service.checkIn(worker, input, 'key')).rejects.toThrow('ALREADY_CHECKED_IN');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('claims an absent row and handles a lost conditional claim', async () => {
    vi.mocked(readWorkerAssignments).mockResolvedValue([{ ...row, attendance: { id: 'absent', checkInAt: null, checkOutAt: null, status: 'ABSENT', verification: null, workDurationMinutes: null } }]);
    vi.mocked(writeAttendance).mockResolvedValue(null);
    await expect(service.checkIn(worker, input, 'key')).rejects.toThrow('ALREADY_CHECKED_IN');
    expect(vi.mocked(writeAttendance).mock.calls[0][1]).toMatchObject({ existingRecordId: 'absent' });
  });
  it('rejects missing key, proof and invalid or ambiguous assignments', async () => {
    await expect(service.checkIn(worker, input, '')).rejects.toThrow('MISSING_IDEMPOTENCY_KEY');
    await expect(service.checkIn(worker, { ...input, proofPhotoDataUrl: undefined }, 'key')).rejects.toThrow('PROOF_PHOTO_REQUIRED');
    vi.mocked(readWorkerAssignments).mockResolvedValue([{ ...row, id: null }]);
    await expect(service.checkIn(worker, input, 'key')).rejects.toThrow('NO_VALID_ASSIGNMENT');
    vi.mocked(readWorkerAssignments).mockResolvedValue([row, { ...row, id: 'second' }]);
    await expect(service.checkIn(worker, input, 'key')).rejects.toThrow('AMBIGUOUS_ASSIGNMENT');
    expect(writeAttendance).not.toHaveBeenCalled();
  });
  it('does not save when authorization or proof persistence fails', async () => {
    authorize.mockRejectedValueOnce(new Error('FORBIDDEN_SCOPE'));
    await expect(service.checkIn(worker, input, 'key')).rejects.toThrow('FORBIDDEN_SCOPE');
    expect(photo).not.toHaveBeenCalled();
    photo.mockRejectedValueOnce(new Error('PHOTO_UPLOAD_FAILED'));
    await expect(service.checkIn(worker, input, 'key')).rejects.toThrow('PHOTO_UPLOAD_FAILED');
    expect(writeAttendance).not.toHaveBeenCalled();
  });
});
