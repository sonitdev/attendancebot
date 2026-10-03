import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceService } from '../src/attendance/attendance.service.js';
import type { WorkerPrincipal } from '../src/auth/principal.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { readWorkerAssignments, readOpenAttendance, readAttendanceReplay } from '../src/attendance/worker-read-model.js';
import { writeAttendance } from '../src/attendance/attendance-write-model.js';
import { getSiteDate } from '../src/attendance/schedule-evaluator.js';

vi.mock('../src/attendance/worker-read-model.js', () => ({ readWorkerAssignments: vi.fn(), readOpenAttendance: vi.fn(), readAttendanceReplay: vi.fn() }));
vi.mock('../src/attendance/attendance-write-model.js', () => ({ writeAttendance: vi.fn() }));

describe('Telegram 22-scenario master lifecycle', () => {
  const worker: WorkerPrincipal = {
    type: 'worker',
    organizationId: 'org-1',
    employeeId: 'employee-dara',
    telegramUserId: 'telegram-dara',
    sessionId: 'session-dara',
  };

  const projects = {
    'project-a': { id: 'project-a', name: 'Borey Project A', status: 'ACTIVE', telegramChatId: '-100-a' },
    'project-b': { id: 'project-b', name: 'Borey Project B', status: 'ACTIVE', telegramChatId: '-100-b' },
  } as const;

  const assignments = {
    'project-a': {
      id: 'assignment-a', siteId: 'site-a', startsOn: new Date('2026-01-01T00:00:00.000Z'), endsOn: null,
      site: { id: 'site-a', projectId: 'project-a', name: 'Site A', latitude: 11.5564, longitude: 104.9282, allowedRadiusMeters: 100, timezone: 'Asia/Phnom_Penh' },
      schedule: { id: 'schedule-a', name: 'Day Shift', startTime: '08:00', endTime: '17:00', graceMinutes: 15 },
    },
    'project-b': {
      id: 'assignment-b', siteId: 'site-b', startsOn: new Date('2026-01-01T00:00:00.000Z'), endsOn: null,
      site: { id: 'site-b', projectId: 'project-b', name: 'Site B', latitude: 11.5564, longitude: 104.9282, allowedRadiusMeters: 100, timezone: 'Asia/Phnom_Penh' },
      schedule: { id: 'schedule-b', name: 'Day Shift', startTime: '08:00', endTime: '17:00', graceMinutes: 15 },
    },
  } as const;

  let currentProjectId: keyof typeof projects = 'project-a';
  let records: any[];
  let prisma: any;
  let service: AttendanceService;

  beforeEach(() => {
    vi.useFakeTimers();
    records = [];
    currentProjectId = 'project-a';

    const findRecord = (where: any) => {
      if (where.id) return records.find((record) => record.id === where.id) ?? null;
      const key = where.assignmentId_attendanceDate;
      return records.find((record) => record.assignmentId === key.assignmentId && record.attendanceDate.getTime() === key.attendanceDate.getTime()) ?? null;
    };

    prisma = {
      employee: {
        findFirst: vi.fn(async (args: any) => args?.select?.fullName
          ? { fullName: 'Dara' }
          : { id: 'employee-dara', currentProjectId, currentProject: projects[currentProjectId] }),
        update: vi.fn(async ({ data }: any) => {
          if (data.currentProjectId) currentProjectId = data.currentProjectId;
          return { id: 'employee-dara', currentProjectId };
        }),
      },
      workerProject: {
        findUnique: vi.fn(async () => ({ id: `connection-${currentProjectId}` })),
        findFirst: vi.fn(async ({ where }: any) => ({ id: `connection-${where.projectId}`, project: projects[where.projectId as keyof typeof projects] })),
        update: vi.fn(async () => ({})),
      },
      assignment: {
        findMany: vi.fn(async () => [assignments[currentProjectId]]),
      },
      attendanceRequest: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
      attendanceRecord: {
        findUnique: vi.fn(async ({ where }: any) => findRecord(where)),
        findUniqueOrThrow: vi.fn(async ({ where }: any) => findRecord(where)),
        findFirst: vi.fn(async () => records.filter((record) => record.checkInAt && !record.checkOutAt).at(-1) ?? null),
        create: vi.fn(async ({ data }: any) => {
          const record = { id: `attendance-${records.length + 1}`, ...data, updatedAt: data.checkInAt, workDurationMinutes: null, assignment: assignments[data.projectId as keyof typeof assignments] };
          records.push(record);
          return record;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const record = findRecord(where);
          Object.assign(record, data, { updatedAt: new Date() });
          return record;
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      attendanceEvent: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
      telegramDelivery: { upsert: vi.fn(async ({ create }: any) => ({ id: `delivery-${create.attendanceRecordId}-${create.kind}` })) },
      project: { findFirst: vi.fn(async ({ where }: any) => projects[where.id as keyof typeof projects]) },
      $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    };

    vi.mocked(readAttendanceReplay).mockResolvedValue(null);
    vi.mocked(readWorkerAssignments).mockImplementation(async () => [{
      ...assignments[currentProjectId],
      currentProject: { ...projects[currentProjectId], organizationId: worker.organizationId, workMode: 'SITE', employeeFullName: 'Dara' },
      connection: { id: `connection-${currentProjectId}`, organizationId: worker.organizationId, employeeId: worker.employeeId, projectId: currentProjectId },
      attendance: records.find(record => record.assignmentId === assignments[currentProjectId].id && record.attendanceDate.toISOString().slice(0, 10) === getSiteDate(new Date(), 'Asia/Phnom_Penh')) ?? null,
    }]);
    vi.mocked(readOpenAttendance).mockImplementation(async () => {
      const record = records.filter(record => record.checkInAt && !record.checkOutAt).at(-1);
      return record ? { ...record, employeeFullName: 'Dara', project: { ...projects[record.projectId as keyof typeof projects], organizationId: worker.organizationId, workMode: 'SITE' }, connection: null } : null;
    });
    // SQL ownership/atomicity is covered by attendance-write-model.spec.ts. This
    // stateful fixture checks the service's multi-day/project orchestration.
    vi.mocked(writeAttendance).mockImplementation(async (_db, input) => {
      let record;
      if (input.action === 'CHECK_IN') {
        record = await prisma.attendanceRecord.create({ data: {
          organizationId: input.organizationId, employeeId: input.employeeId,
          assignmentId: input.assignmentId, projectId: input.projectId, siteId: input.siteId,
          telegramChatId: input.telegramChatId, attendanceDate: input.attendanceDate,
          checkInAt: input.now, checkOutAt: null, status: input.status,
        } });
      } else {
        record = await prisma.attendanceRecord.update({ where: { id: input.recordId }, data: {
          checkOutAt: input.now, status: input.status, workDurationMinutes: input.workDurationMinutes,
        } });
      }
      return { record, deliveryIds: [] };
    });
    service = new AttendanceService(prisma as unknown as PrismaService, undefined as any, { dispatch: vi.fn() } as any,
      { authorizeWorkerProject: vi.fn().mockResolvedValue(null) } as any);
    vi.spyOn(service as any, 'storeCheckInPhoto').mockImplementation(async (_input: unknown, _principal: unknown, key: string) => `evidence/${key}.jpg`);
  });

  afterEach(() => vi.useRealTimers());

  it('stores A, then B, then maintenance A while every older record remains unchanged', async () => {
    vi.setSystemTime(new Date('2026-09-28T01:05:00.000Z'));
    const checkInA = await service.checkIn(worker, { latitude: 11.5564, longitude: 104.9282, accuracyMeters: 8, proofPhotoDataUrl: 'data:image/jpeg;base64,AA==' }, 'a-checkin');
    vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
    await service.checkOut(worker, { latitude: 11.5564, longitude: 104.9282, accuracyMeters: 8 }, 'a-checkout');
    const originalA = structuredClone(records[0]);

    await service.setCurrentProject(worker, 'project-b');
    vi.setSystemTime(new Date('2026-09-29T01:05:00.000Z'));
    const checkInB = await service.checkIn(worker, { latitude: 11.5564, longitude: 104.9282, accuracyMeters: 8, proofPhotoDataUrl: 'data:image/jpeg;base64,AA==' }, 'b-checkin');
    const originalB = structuredClone(records[1]);

    await service.setCurrentProject(worker, 'project-a');
    vi.setSystemTime(new Date('2026-10-15T01:05:00.000Z'));
    const maintenanceA = await service.checkIn(worker, { latitude: 11.5564, longitude: 104.9282, accuracyMeters: 8, proofPhotoDataUrl: 'data:image/jpeg;base64,AA==' }, 'a-maintenance');

    expect(checkInA.attendanceId).toBe('attendance-1');
    expect(checkInB.attendanceId).toBe('attendance-2');
    expect(maintenanceA.attendanceId).toBe('attendance-3');
    expect(records.map((record) => [record.projectId, record.telegramChatId])).toEqual([
      ['project-a', '-100-a'],
      ['project-b', '-100-b'],
      ['project-a', '-100-a'],
    ]);
    expect(records[0]).toEqual(originalA);
    expect(records[1]).toEqual(originalB);
    expect(currentProjectId).toBe('project-a');
    expect(prisma.employee.update).toHaveBeenCalledTimes(2);
  });
});
