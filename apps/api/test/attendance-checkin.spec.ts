import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceService } from '../src/attendance/attendance.service.js';
import type { WorkerPrincipal } from '../src/auth/principal.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('AttendanceService - Check-In', () => {
  let attendanceService: AttendanceService;
  let mockPrisma: any;

  const worker: WorkerPrincipal = {
    type: 'worker',
    organizationId: 'org-tenant-1',
    employeeId: 'emp-101',
    telegramUserId: 'tg-999',
    sessionId: 'session-xyz',
  };

  const sampleAssignment = {
    id: 'assignment-1',
    organizationId: 'org-tenant-1',
    employeeId: 'emp-101',
    siteId: 'site-1',
    scheduleId: 'schedule-1',
    startsOn: new Date('2026-01-01T00:00:00.000Z'),
    endsOn: new Date('2026-12-31T00:00:00.000Z'),
    status: 'ACTIVE',
    site: {
      id: 'site-1',
      name: 'Phnom Penh Site A',
      latitude: 11.5564,
      longitude: 104.9282,
      allowedRadiusMeters: 100,
      timezone: 'Asia/Phnom_Penh',
      status: 'ACTIVE',
    },
    schedule: {
      id: 'schedule-1',
      name: 'Standard Day Shift',
      timezone: 'Asia/Phnom_Penh',
      startTime: '08:00',
      endTime: '17:00',
      graceMinutes: 15,
    },
  };

  beforeEach(() => {
    mockPrisma = {
      assignment: {
        findMany: vi.fn(),
      },
      attendanceRecord: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
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

  it('records a verified check-in when worker is inside the geofence within grace period', async () => {
    mockPrisma.attendanceRequest.findUnique.mockResolvedValue(null);
    mockPrisma.assignment.findMany.mockResolvedValue([sampleAssignment]);
    mockPrisma.attendanceRecord.findUnique.mockResolvedValue(null);

    mockPrisma.attendanceRecord.upsert.mockResolvedValue({
      id: 'rec-1',
      organizationId: 'org-tenant-1',
      employeeId: 'emp-101',
      status: 'ON_TIME',
      checkInVerification: 'VERIFIED',
      checkInAt: new Date(),
      checkInDistanceMeters: 2.5,
    });

    const result = await attendanceService.checkIn(
      worker,
      {
        latitude: 11.5564,
        longitude: 104.9282,
        accuracyMeters: 10,
      },
      'idempotency-key-001',
    );

    expect(result.attendanceId).toBe('rec-1');
    expect(result.verificationResult).toBe('VERIFIED');
    expect(result.action).toBe('CHECK_IN');

    // Verify transaction operations
    expect(mockPrisma.attendanceRecord.upsert).toHaveBeenCalled();
    expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attendanceRecordId: 'rec-1',
          type: 'CHECK_IN_SUCCESS',
        }),
      }),
    );
    expect(mockPrisma.attendanceRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'idempotency-key-001',
          action: 'CHECK_IN',
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ATTENDANCE_CHECK_IN',
          targetId: 'rec-1',
        }),
      }),
    );
  });

  it('flags OUTSIDE_GEOFENCE when coordinate distance exceeds allowed radius', async () => {
    mockPrisma.attendanceRequest.findUnique.mockResolvedValue(null);
    mockPrisma.assignment.findMany.mockResolvedValue([sampleAssignment]);
    mockPrisma.attendanceRecord.findUnique.mockResolvedValue(null);

    mockPrisma.attendanceRecord.upsert.mockResolvedValue({
      id: 'rec-2',
      organizationId: 'org-tenant-1',
      employeeId: 'emp-101',
      status: 'OUTSIDE_GEOFENCE',
      checkInVerification: 'OUTSIDE_GEOFENCE',
      checkInAt: new Date(),
      checkInDistanceMeters: 550.0,
    });

    // Coordinate ~500m away
    const result = await attendanceService.checkIn(
      worker,
      {
        latitude: 11.5614,
        longitude: 104.9282,
        accuracyMeters: 15,
      },
      'idempotency-key-002',
    );

    expect(result.verificationResult).toBe('OUTSIDE_GEOFENCE');
    expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'CHECK_IN_OUTSIDE_GEOFENCE',
        }),
      }),
    );
  });

  it('flags LOW_ACCURACY when GPS reported accuracy is worse than threshold', async () => {
    mockPrisma.attendanceRequest.findUnique.mockResolvedValue(null);
    mockPrisma.assignment.findMany.mockResolvedValue([sampleAssignment]);
    mockPrisma.attendanceRecord.findUnique.mockResolvedValue(null);

    mockPrisma.attendanceRecord.upsert.mockResolvedValue({
      id: 'rec-3',
      organizationId: 'org-tenant-1',
      employeeId: 'emp-101',
      status: 'LOW_ACCURACY',
      checkInVerification: 'LOW_ACCURACY',
      checkInAt: new Date(),
      checkInDistanceMeters: 5.0,
    });

    const result = await attendanceService.checkIn(
      worker,
      {
        latitude: 11.5564,
        longitude: 104.9282,
        accuracyMeters: 250, // imprecise accuracy > 100m
      },
      'idempotency-key-003',
    );

    expect(result.verificationResult).toBe('LOW_ACCURACY');
    expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'CHECK_IN_LOW_ACCURACY',
        }),
      }),
    );
  });

  it('returns cached idempotent response on repeated request with identical key without new DB mutations', async () => {
    mockPrisma.attendanceRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      attendanceRecordId: 'rec-existing-1',
      action: 'CHECK_IN',
    });

    mockPrisma.attendanceRecord.findUnique.mockResolvedValue({
      id: 'rec-existing-1',
      status: 'ON_TIME',
      checkInVerification: 'VERIFIED',
      checkInAt: new Date('2026-09-18T01:05:00.000Z'),
      checkInDistanceMeters: 12.0,
      createdAt: new Date('2026-09-18T01:05:00.000Z'),
    });

    const result = await attendanceService.checkIn(
      worker,
      {
        latitude: 11.5564,
        longitude: 104.9282,
        accuracyMeters: 10,
      },
      'idempotency-key-repeat',
    );

    expect(result.attendanceId).toBe('rec-existing-1');
    expect(result.message).toContain('idempotent');
    // Ensure no new record or event was created
    expect(mockPrisma.attendanceRecord.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate check-in on the same day when a different key is submitted', async () => {
    mockPrisma.attendanceRequest.findUnique.mockResolvedValue(null);
    mockPrisma.assignment.findMany.mockResolvedValue([sampleAssignment]);

    // Already checked in today
    mockPrisma.attendanceRecord.findUnique.mockResolvedValue({
      id: 'rec-1',
      checkInAt: new Date(),
    });

    await expect(
      attendanceService.checkIn(
        worker,
        {
          latitude: 11.5564,
          longitude: 104.9282,
          accuracyMeters: 10,
        },
        'new-key-different',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects check-in when no valid assignment exists for today', async () => {
    mockPrisma.attendanceRequest.findUnique.mockResolvedValue(null);
    mockPrisma.assignment.findMany.mockResolvedValue([]); // No assignments

    await expect(
      attendanceService.checkIn(
        worker,
        {
          latitude: 11.5564,
          longitude: 104.9282,
          accuracyMeters: 10,
        },
        'key-123',
      ),
    ).rejects.toThrow(new NotFoundException('NO_VALID_ASSIGNMENT'));
  });

  it('rejects check-in when missing idempotency key', async () => {
    await expect(
      attendanceService.checkIn(
        worker,
        {
          latitude: 11.5564,
          longitude: 104.9282,
          accuracyMeters: 10,
        },
        '',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
