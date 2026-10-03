import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceService } from '../src/attendance/attendance.service.js';
import type { WorkerPrincipal } from '../src/auth/principal.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('AttendanceService - sales visit flow', () => {
  const worker: WorkerPrincipal = {
    type: 'worker',
    organizationId: 'org-1',
    employeeId: 'employee-1',
    telegramUserId: 'telegram-1',
    sessionId: 'session-1',
  };

  let prisma: any;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'employee-1',
          currentProjectId: 'project-sales',
          currentProject: { id: 'project-sales', name: 'Sales Team', status: 'ACTIVE', workMode: 'SALES' },
        }),
      },
      workerProject: { findUnique: vi.fn().mockResolvedValue({ id: 'connection-1' }) },
      attendanceRecord: { findFirst: vi.fn() },
      assignment: { findMany: vi.fn() },
      visitLog: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    service = new AttendanceService(prisma as unknown as PrismaService, undefined as any, undefined as any);
  });

  it('stores immutable photo, GPS and optional customer context under the current project', async () => {
    prisma.attendanceRecord.findFirst.mockResolvedValue({ id: 'attendance-1' });
    prisma.assignment.findMany.mockResolvedValue([{
      id: 'assignment-1',
      siteId: 'site-1',
      site: {
        id: 'site-1',
        latitude: 11.5564,
        longitude: 104.9282,
        allowedRadiusMeters: 100,
      },
    }]);
    prisma.visitLog.create.mockResolvedValue({
      id: 'visit-1',
      visitedAt: new Date('2026-09-28T02:00:00.000Z'),
      distanceMeters: 0,
      verification: 'VERIFIED',
    });
    vi.spyOn(service as any, 'storeCheckInPhoto').mockResolvedValue('org-1/employee-1/visit-proof.jpg');

    const result = await service.recordVisit(worker, {
      latitude: 11.5564,
      longitude: 104.9282,
      accuracyMeters: 8,
      proofPhotoDataUrl: 'data:image/jpeg;base64,AA==',
      customerName: 'Customer A',
      note: 'Product presentation',
    }, 'visit-key-1');

    expect(result.visitId).toBe('visit-1');
    expect(prisma.visitLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        employeeId: 'employee-1',
        projectId: 'project-sales',
        siteId: 'site-1',
        proofPhotoPath: 'org-1/employee-1/visit-proof.jpg',
        customerName: 'Customer A',
        note: 'Product presentation',
        idempotencyKey: 'visit-key-1',
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'VISIT_RECORDED', targetId: 'visit-1' }),
    });
  });

  it('requires an open check-in in the current project before recording a visit', async () => {
    prisma.attendanceRecord.findFirst.mockResolvedValue(null);

    await expect(service.recordVisit(worker, {
      latitude: 11.5564,
      longitude: 104.9282,
      accuracyMeters: 8,
      proofPhotoDataUrl: 'data:image/jpeg;base64,AA==',
    }, 'visit-key-2')).rejects.toThrow(new BadRequestException('CHECK_IN_REQUIRED_FOR_VISIT'));

    expect(prisma.visitLog.create).not.toHaveBeenCalled();
  });

  it('returns the original visit for an identical retry without new evidence', async () => {
    prisma.visitLog.findUnique.mockResolvedValue({
      id: 'visit-existing',
      visitedAt: new Date('2026-09-28T02:00:00.000Z'),
      distanceMeters: 12,
      verification: 'VERIFIED',
    });

    await expect(service.recordVisit(worker, {
      latitude: 11.5564,
      longitude: 104.9282,
      accuracyMeters: 8,
      proofPhotoDataUrl: 'data:image/jpeg;base64,AA==',
    }, 'visit-repeat')).resolves.toMatchObject({ visitId: 'visit-existing', message: 'Visit recorded (idempotent)' });

    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    expect(prisma.visitLog.create).not.toHaveBeenCalled();
  });
});
