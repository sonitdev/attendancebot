import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionService } from '../src/attendance/correction.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('CorrectionService', () => {
  let correctionService: CorrectionService;
  let mockPrisma: any;

  const mockOrgId = 'org-acme-1';
  const mockUserId = 'usr-manager-1';

  beforeEach(() => {
    mockPrisma = {
      attendanceRecord: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      attendanceCorrection: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      attendanceEvent: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    };

    correctionService = new CorrectionService(mockPrisma as unknown as PrismaService);
  });

  describe('createCorrection', () => {
    it('successfully proposes a correction and logs an immutable audit event', async () => {
      mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'rec-123',
        organizationId: mockOrgId,
        attendanceDate: new Date('2026-09-18T00:00:00.000Z'),
        checkInAt: new Date('2026-09-18T08:00:00.000Z'),
        checkOutAt: null,
        status: 'MISSING_CHECKOUT',
        employee: {
          id: 'emp-1',
          fullName: 'Sokha Chan',
          employeeCode: 'EMP-001',
        },
        assignment: {
          site: {
            name: 'Site Alpha',
          },
        },
      });

      mockPrisma.attendanceCorrection.create.mockResolvedValue({
        id: 'corr-1',
        organizationId: mockOrgId,
        attendanceRecordId: 'rec-123',
        requestedByUserId: mockUserId,
        approvedByUserId: null,
        status: 'PENDING',
        reason: 'Worker forgot to check out when power was lost at site.',
        correctedCheckInAt: null,
        correctedCheckOutAt: new Date('2026-09-18T17:00:00.000Z'),
        correctedStatus: 'COMPLETED',
        createdAt: new Date('2026-09-18T18:00:00.000Z'),
        resolvedAt: null,
      });

      const result = await correctionService.createCorrection(
        mockOrgId,
        'rec-123',
        {
          reason: 'Worker forgot to check out when power was lost at site.',
          correctedCheckOutAt: '2026-09-18T17:00:00.000Z',
          correctedStatus: 'COMPLETED',
        },
        mockUserId,
      );

      expect(result.id).toBe('corr-1');
      expect(result.status).toBe('PENDING');
      expect(result.reason).toBe('Worker forgot to check out when power was lost at site.');

      // Verify event was created
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: mockOrgId,
          attendanceRecordId: 'rec-123',
          type: 'MANUAL_CORRECTION',
          metadata: expect.objectContaining({
            action: 'CORRECTION_PROPOSED',
            reason: 'Worker forgot to check out when power was lost at site.',
          }),
        }),
      });

      // Verify audit log entry
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: mockOrgId,
          actorUserId: mockUserId,
          action: 'CORRECTION_PROPOSED',
          targetType: 'AttendanceRecord',
          targetId: 'rec-123',
        }),
      });
    });

    it('throws NotFoundException if the record is missing or cross-organization', async () => {
      mockPrisma.attendanceRecord.findFirst.mockResolvedValue(null);

      await expect(
        correctionService.createCorrection(mockOrgId, 'invalid-id', {
          reason: 'Valid justification note',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if date is unparseable', async () => {
      mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'rec-123',
        organizationId: mockOrgId,
        employee: { id: 'emp-1' },
        assignment: { site: { name: 'Site Alpha' } },
      });

      await expect(
        correctionService.createCorrection(mockOrgId, 'rec-123', {
          reason: 'Valid justification note',
          correctedCheckInAt: 'invalid-date-format',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveCorrection', () => {
    it('approves correction: updates record status/duration, preserves GPS evidence intact', async () => {
      const originalRecord = {
        id: 'rec-123',
        organizationId: mockOrgId,
        attendanceDate: new Date('2026-09-18T00:00:00.000Z'),
        checkInAt: new Date('2026-09-18T08:00:00.000Z'),
        checkOutAt: null,
        checkInLatitude: 11.5564,
        checkInLongitude: 104.9282,
        checkInAccuracyMeters: 12.5,
        checkInDistanceMeters: 45.2,
        checkInVerification: 'VERIFIED',
        status: 'MISSING_CHECKOUT',
        workDurationMinutes: null,
        employee: {
          id: 'emp-1',
          fullName: 'Sokha Chan',
          employeeCode: 'EMP-001',
        },
        assignment: {
          site: { name: 'Site Alpha' },
        },
      };

      const pendingCorrection = {
        id: 'corr-1',
        organizationId: mockOrgId,
        attendanceRecordId: 'rec-123',
        requestedByUserId: 'usr-requester',
        approvedByUserId: null,
        status: 'PENDING',
        reason: 'Shift ended at 17:00 officially',
        correctedCheckInAt: null,
        correctedCheckOutAt: new Date('2026-09-18T17:00:00.000Z'),
        correctedStatus: 'COMPLETED',
        createdAt: new Date('2026-09-18T18:00:00.000Z'),
        attendanceRecord: originalRecord,
      };

      mockPrisma.attendanceCorrection.findFirst.mockResolvedValue(pendingCorrection);
      mockPrisma.attendanceCorrection.update.mockResolvedValue({
        ...pendingCorrection,
        status: 'APPROVED',
        approvedByUserId: mockUserId,
      });

      const result = await correctionService.resolveCorrection(
        mockOrgId,
        'corr-1',
        { approved: true, note: 'Approved after checking site supervisor log' },
        mockUserId,
      );

      expect(result.status).toBe('APPROVED');

      // Check that attendanceRecord.update did NOT alter GPS coordinates
      expect(mockPrisma.attendanceRecord.update).toHaveBeenCalledWith({
        where: { id: 'rec-123' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          checkOutAt: pendingCorrection.correctedCheckOutAt,
          workDurationMinutes: 540, // 9 hours = 540 minutes
        }),
      });

      const updateCall = mockPrisma.attendanceRecord.update.mock.calls[0][0];
      expect(updateCall.data.checkInLatitude).toBeUndefined();
      expect(updateCall.data.checkInLongitude).toBeUndefined();
      expect(updateCall.data.checkInAccuracyMeters).toBeUndefined();
      expect(updateCall.data.checkInDistanceMeters).toBeUndefined();

      // Check event and audit creation
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: mockOrgId,
          type: 'MANAGER_OVERRIDE',
          metadata: expect.objectContaining({
            action: 'CORRECTION_APPROVED',
            resolutionNote: 'Approved after checking site supervisor log',
          }),
        }),
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: mockOrgId,
          actorUserId: mockUserId,
          action: 'CORRECTION_APPROVED',
        }),
      });
    });

    it('rejects correction: marks correction REJECTED and leaves attendanceRecord untouched', async () => {
      const originalRecord = {
        id: 'rec-123',
        organizationId: mockOrgId,
        attendanceDate: new Date('2026-09-18T00:00:00.000Z'),
        checkInAt: new Date('2026-09-18T08:00:00.000Z'),
        checkOutAt: null,
        status: 'MISSING_CHECKOUT',
        employee: {
          id: 'emp-1',
          fullName: 'Sokha Chan',
          employeeCode: 'EMP-001',
        },
        assignment: {
          site: { name: 'Site Alpha' },
        },
      };

      const pendingCorrection = {
        id: 'corr-1',
        organizationId: mockOrgId,
        attendanceRecordId: 'rec-123',
        requestedByUserId: 'usr-requester',
        approvedByUserId: null,
        status: 'PENDING',
        reason: 'Disputed early departure',
        correctedCheckInAt: null,
        correctedCheckOutAt: new Date('2026-09-18T17:00:00.000Z'),
        correctedStatus: 'COMPLETED',
        createdAt: new Date('2026-09-18T18:00:00.000Z'),
        attendanceRecord: originalRecord,
      };

      mockPrisma.attendanceCorrection.findFirst.mockResolvedValue(pendingCorrection);
      mockPrisma.attendanceCorrection.update.mockResolvedValue({
        ...pendingCorrection,
        status: 'REJECTED',
        approvedByUserId: mockUserId,
      });

      const result = await correctionService.resolveCorrection(
        mockOrgId,
        'corr-1',
        { approved: false, note: 'Camera showed worker was absent afternoon' },
        mockUserId,
      );

      expect(result.status).toBe('REJECTED');
      expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CORRECTION_REJECTED',
          actorUserId: mockUserId,
        }),
      });
    });

    it('throws ConflictException if correction is already approved or rejected', async () => {
      mockPrisma.attendanceCorrection.findFirst.mockResolvedValue({
        id: 'corr-1',
        organizationId: mockOrgId,
        status: 'APPROVED',
      });

      await expect(
        correctionService.resolveCorrection(mockOrgId, 'corr-1', { approved: true }, mockUserId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('exportAttendanceRecords', () => {
    it('generates valid RFC 4180 CSV export with site local timezones and durations', async () => {
      mockPrisma.attendanceRecord.findMany.mockResolvedValue([
        {
          id: 'rec-1',
          attendanceDate: new Date('2026-09-18T00:00:00.000Z'),
          checkInAt: new Date('2026-09-18T01:00:00.000Z'), // 08:00 in Asia/Phnom_Penh
          checkOutAt: new Date('2026-09-18T10:00:00.000Z'), // 17:00 in Asia/Phnom_Penh
          workDurationMinutes: 540,
          status: 'COMPLETED',
          checkInVerification: 'VERIFIED',
          checkInDistanceMeters: 25.5,
          employee: {
            employeeCode: 'EMP-001',
            fullName: 'Sokha Chan',
          },
          assignment: {
            site: {
              name: 'Main Construction Site A',
              timezone: 'Asia/Phnom_Penh',
              project: {
                code: 'PRJ-ALPHA',
                name: 'Alpha Tower',
              },
            },
            schedule: {
              startTime: '08:00',
              endTime: '17:00',
            },
          },
          corrections: [{ id: 'c-1' }],
        },
      ]);

      const result = await correctionService.exportAttendanceRecords(mockOrgId, {
        format: 'csv',
      });

      expect(result.format).toBe('csv');
      expect(typeof result.data).toBe('string');
      const csvStr = result.data as string;
      expect(csvStr).toContain('Record ID,Date,Employee Code,Employee Name');
      expect(csvStr).toContain('EMP-001');
      expect(csvStr).toContain('Sokha Chan');
      expect(csvStr).toContain('Alpha Tower');
      expect(csvStr).toContain('Main Construction Site A');
      expect(csvStr).toContain('Asia/Phnom_Penh');
      expect(csvStr).toContain('9h 0m');
      expect(csvStr).toContain('COMPLETED');
      expect(csvStr).toContain('YES'); // Has corrections
    });
  });
});
