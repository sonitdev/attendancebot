import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceService } from '../src/attendance/attendance.service.js';
import type { WorkerPrincipal } from '../src/auth/principal.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('AttendanceService - Check-Out', () => {
  let attendanceService: AttendanceService;
  let mockPrisma: any;

  const worker: WorkerPrincipal = {
    type: 'worker',
    organizationId: 'org-tenant-1',
    employeeId: 'emp-101',
    telegramUserId: 'tg-999',
    sessionId: 'session-xyz',
  };

  const sampleOpenRecord = {
    id: 'rec-open-1',
    organizationId: 'org-tenant-1',
    employeeId: 'emp-101',
    checkInAt: new Date(Date.now() - 8 * 3600 * 1000), // 8 hours ago
    checkOutAt: null,
    assignment: {
      site: {
        id: 'site-1',
        name: 'Phnom Penh Site A',
        latitude: 11.5564,
        longitude: 104.9282,
        allowedRadiusMeters: 100,
        timezone: 'Asia/Phnom_Penh',
      },
      schedule: {
        id: 'schedule-1',
        name: 'Standard Day Shift',
        startTime: '08:00',
        endTime: '17:00',
        graceMinutes: 15,
      },
    },
  };

  beforeEach(() => {
    mockPrisma = {
      attendanceRecord: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      attendanceRequest: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      attendanceEvent: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    };

    attendanceService = new AttendanceService(mockPrisma as unknown as PrismaService);
  });

  it('successfully checks out, calculates work duration, and closes the attendance record', async () => {
    mockPrisma.attendanceRequest.findUnique.mockResolvedValue(null);
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue(sampleOpenRecord);

    mockPrisma.attendanceRecord.update.mockResolvedValue({
      id: 'rec-open-1',
      status: 'COMPLETED',
      checkOutVerification: 'VERIFIED',
      checkOutAt: new Date(),
      workDurationMinutes: 480,
    });

    const result = await attendanceService.checkOut(
      worker,
      {
        latitude: 11.5564,
        longitude: 104.9282,
        accuracyMeters: 10,
      },
      'checkout-key-001',
    );

    expect(result.attendanceId).toBe('rec-open-1');
    expect(result.action).toBe('CHECK_OUT');
    expect(result.workDurationMinutes).toBe(480);
    expect(result.verificationResult).toBe('VERIFIED');

    // Verify transaction operations
    expect(mockPrisma.attendanceRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-open-1' },
      }),
    );
    expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'CHECK_OUT_SUCCESS',
          attendanceRecordId: 'rec-open-1',
        }),
      }),
    );
    expect(mockPrisma.attendanceRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CHECK_OUT',
          idempotencyKey: 'checkout-key-001',
        }),
      }),
    );
  });

  it('rejects check-out when no open attendance record exists', async () => {
    mockPrisma.attendanceRequest.findUnique.mockResolvedValue(null);
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue(null); // No open check-in

    await expect(
      attendanceService.checkOut(
        worker,
        {
          latitude: 11.5564,
          longitude: 104.9282,
          accuracyMeters: 10,
        },
        'checkout-key-002',
      ),
    ).rejects.toThrow(new BadRequestException('NO_OPEN_ATTENDANCE'));
  });

  it('returns cached idempotent response on repeated checkout with identical key', async () => {
    mockPrisma.attendanceRequest.findUnique.mockResolvedValue({
      id: 'req-checkout-1',
      attendanceRecordId: 'rec-open-1',
      action: 'CHECK_OUT',
    });

    mockPrisma.attendanceRecord.findUnique.mockResolvedValue({
      id: 'rec-open-1',
      status: 'COMPLETED',
      checkOutVerification: 'VERIFIED',
      checkOutAt: new Date('2026-09-18T09:00:00.000Z'),
      checkOutDistanceMeters: 5.0,
      workDurationMinutes: 480,
    });

    const result = await attendanceService.checkOut(
      worker,
      {
        latitude: 11.5564,
        longitude: 104.9282,
        accuracyMeters: 10,
      },
      'idempotency-key-repeat',
    );

    expect(result.attendanceId).toBe('rec-open-1');
    expect(result.message).toContain('idempotent');
    expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
  });
});
