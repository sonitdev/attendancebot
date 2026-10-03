import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from '../src/admin/admin.service.js';
import { AttendanceService } from '../src/attendance/attendance.service.js';
import type { WorkerPrincipal } from '../src/auth/principal.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('Current Project master flow', () => {
  const worker: WorkerPrincipal = {
    type: 'worker',
    organizationId: 'org-1',
    employeeId: 'employee-1',
    telegramUserId: 'telegram-1',
    sessionId: 'session-1',
  };

  let prisma: any;
  let attendance: AttendanceService;
  let admin: AdminService;

  beforeEach(() => {
    prisma = {
      $queryRaw: vi.fn(),
      employee: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      workerProject: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
      assignment: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      site: { findFirst: vi.fn() },
      workSchedule: { findFirst: vi.fn() },
      attendanceRecord: {
        count: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    };
    attendance = new AttendanceService(prisma as unknown as PrismaService, undefined as any, undefined as any);
    admin = new AdminService(prisma as unknown as PrismaService);
  });

  it('switches from Project A to Project B by changing only the current pointer', async () => {
    prisma.workerProject.findFirst.mockResolvedValue({
      id: 'connection-b',
      organizationId: 'org-1',
      employeeId: 'employee-1',
      projectId: 'project-b',
      project: { id: 'project-b', name: 'Project B', status: 'ACTIVE' },
    });

    await expect(attendance.setCurrentProject(worker, 'project-b')).resolves.toEqual({
      id: 'project-b',
      name: 'Project B',
    });

    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'employee-1' },
      data: { currentProjectId: 'project-b' },
    });
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.delete).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'WORKER_CURRENT_PROJECT_SET',
        targetId: 'project-b',
      }),
    });
  });

  it('rejects a project that the worker has not connected from Telegram', async () => {
    prisma.workerProject.findFirst.mockResolvedValue(null);

    await expect(attendance.setCurrentProject(worker, 'project-x')).rejects.toThrow(
      new NotFoundException('PROJECT_NOT_CONNECTED'),
    );
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  it('blocks attendance when a registered worker has no current project', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(attendance.getWorkerToday(worker)).rejects.toThrow(
      new NotFoundException('NO_CURRENT_PROJECT'),
    );
    expect(prisma.assignment.findMany).not.toHaveBeenCalled();
  });

  it('lists many connected projects while identifying exactly one current project', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'project-b', name: 'Project B', workMode: 'SITE', isCurrent: true },
      { id: 'project-a', name: 'Project A', workMode: 'SITE', isCurrent: false },
    ]);

    await expect(attendance.listConnectedProjects(worker)).resolves.toEqual([
      { id: 'project-b', name: 'Project B', workMode: 'SITE', isCurrent: true },
      { id: 'project-a', name: 'Project A', workMode: 'SITE', isCurrent: false },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([worker.employeeId, worker.organizationId]);
  });

  it('does not mistake a joined project without an assignment for a usable shift', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      currentProject: { id: 'project-b', name: 'Project B', workMode: 'SITE' },
      id: null, startsOn: null, endsOn: null, site: null, schedule: null,
    }]);
    await expect(attendance.getWorkerToday(worker)).rejects.toThrow('NO_VALID_ASSIGNMENT');
    expect(prisma.attendanceRecord.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([worker.employeeId, worker.organizationId]);
  });

  it('keeps using the saved current project on a later day without another switch', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      currentProject: { id: 'project-b', name: 'Project B', workMode: 'SITE' },
      id: 'assignment-b',
      startsOn: new Date('2026-01-01T00:00:00.000Z'),
      endsOn: new Date('2027-01-01T00:00:00.000Z'),
      site: {
        id: 'site-b',
        name: 'Site B',
        projectId: 'project-b',
        latitude: 11.5564,
        longitude: 104.9282,
        allowedRadiusMeters: 100,
        timezone: 'Asia/Phnom_Penh',
      },
      schedule: {
        id: 'schedule-b',
        name: 'Day Shift',
        startTime: '08:00',
        endTime: '17:00',
        graceMinutes: 15,
      },
    }]);
    prisma.attendanceRecord.findFirst.mockResolvedValue(null);

    const today = await attendance.getWorkerToday(worker);

    expect(today.currentProject).toEqual({ id: 'project-b', name: 'Project B', workMode: 'SITE' });
    expect(today.site.id).toBe('site-b');
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.attendanceRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: worker.organizationId, employeeId: worker.employeeId }),
    }));
  });

  it('uses one unambiguous legacy site assignment for a Telegram-created current project', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      currentProject: { id: 'telegram-project', name: 'Attendance Group', workMode: 'SITE' },
      id: 'legacy-assignment',
      startsOn: new Date('2026-01-01T00:00:00.000Z'),
      endsOn: null,
      site: {
        id: 'legacy-site', name: 'Existing Site', projectId: 'legacy-project',
        latitude: 11.5564, longitude: 104.9282, allowedRadiusMeters: 100, timezone: 'Asia/Phnom_Penh',
      },
      schedule: { id: 'schedule-1', name: 'Day Shift', startTime: '08:00', endTime: '17:00', graceMinutes: 15 },
    }]);
    prisma.attendanceRecord.findFirst.mockResolvedValue(null);

    const today = await attendance.getWorkerToday(worker);

    expect(today.currentProject).toEqual({ id: 'telegram-project', name: 'Attendance Group', workMode: 'SITE' });
    expect(today.site).toEqual(expect.objectContaining({ id: 'legacy-site', name: 'Existing Site' }));
  });

  it('refuses to guess when a Telegram-created project has multiple unrelated assignments', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'assignment-1', startsOn: new Date('2026-01-01'), endsOn: null, site: { projectId: 'old-a', timezone: 'Asia/Phnom_Penh' }, schedule: {} },
      { id: 'assignment-2', startsOn: new Date('2026-01-01'), endsOn: null, site: { projectId: 'old-b', timezone: 'Asia/Phnom_Penh' }, schedule: {} },
    ].map(row => ({ ...row, currentProject: { id: 'telegram-project', name: 'Attendance Group', workMode: 'SITE' } })));

    await expect(attendance.getWorkerToday(worker)).rejects.toThrow('AMBIGUOUS_ASSIGNMENT');
  });

  it('can return from B to A and then select B again without deleting either connection', async () => {
    prisma.workerProject.findFirst
      .mockResolvedValueOnce({
        id: 'connection-a',
        project: { id: 'project-a', name: 'Project A', status: 'ACTIVE' },
      })
      .mockResolvedValueOnce({
        id: 'connection-b',
        project: { id: 'project-b', name: 'Project B', status: 'ACTIVE' },
      });

    await attendance.setCurrentProject(worker, 'project-a');
    await attendance.setCurrentProject(worker, 'project-b');

    expect(prisma.employee.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'employee-1' },
      data: { currentProjectId: 'project-a' },
    });
    expect(prisma.employee.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'employee-1' },
      data: { currentProjectId: 'project-b' },
    });
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.delete).not.toHaveBeenCalled();
  });

  it('blocks assignment site changes after attendance exists', async () => {
    prisma.assignment.findFirst.mockResolvedValue({
      id: 'assignment-1',
      organizationId: 'org-1',
      siteId: 'site-a',
      scheduleId: 'schedule-1',
    });
    prisma.site.findFirst.mockResolvedValue({ id: 'site-b', organizationId: 'org-1' });
    prisma.attendanceRecord.count.mockResolvedValue(2);

    await expect(
      admin.updateAssignment('org-1', 'assignment-1', { siteId: 'site-b' }),
    ).rejects.toThrow(new ConflictException('ASSIGNMENT_CANNOT_CHANGE_AFTER_ATTENDANCE'));
    expect(prisma.assignment.update).not.toHaveBeenCalled();
  });
});
