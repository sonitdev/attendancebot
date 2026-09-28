import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from '../src/admin/admin.service.js';
import { AttendanceService } from '../src/attendance/attendance.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('Admin Attendance and Setup Services', () => {
  let adminService: AdminService;
  let attendanceService: AttendanceService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      employee: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      project: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      site: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      workSchedule: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      assignment: {
        create: vi.fn(),
      },
      telegramAccount: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      attendanceRecord: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    };

    adminService = new AdminService(mockPrisma as unknown as PrismaService);
    attendanceService = new AttendanceService(mockPrisma as unknown as PrismaService);
  });

  describe('AdminService', () => {
    it('creates an employee within organization boundary', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue(null);
      mockPrisma.employee.create.mockResolvedValue({
        id: 'emp-new',
        organizationId: 'org-tenant-1',
        employeeCode: 'EMP-999',
        fullName: 'New Worker',
        status: 'ACTIVE',
      });

      const result = await adminService.createEmployee('org-tenant-1', {
        employeeCode: 'EMP-999',
        fullName: 'New Worker',
      });

      expect(result.id).toBe('emp-new');
      expect(mockPrisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-tenant-1',
            employeeCode: 'EMP-999',
          }),
        }),
      );
    });

    it('rejects duplicate employeeCode within the same organization', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: 'emp-existing',
        employeeCode: 'EMP-999',
      });

      await expect(
        adminService.createEmployee('org-tenant-1', {
          employeeCode: 'EMP-999',
          fullName: 'Duplicate Worker',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('links telegram account and creates audit log', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: 'emp-1',
        organizationId: 'org-tenant-1',
        status: 'ACTIVE',
        telegramAccount: null,
      });
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(null);
      mockPrisma.telegramAccount.create.mockResolvedValue({
        id: 'tg-acc-1',
        organizationId: 'org-tenant-1',
        employeeId: 'emp-1',
        telegramUserId: '12345678',
      });

      const result = await adminService.linkTelegramAccount(
        'org-tenant-1',
        {
          employeeId: 'emp-1',
          telegramUserId: '12345678',
          username: 'worker_tg',
        },
        'admin-user-1',
      );

      expect(result.id).toBe('tg-acc-1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-tenant-1',
            action: 'TELEGRAM_ACCOUNT_LINKED',
            actorUserId: 'admin-user-1',
          }),
        }),
      );
    });
  });

  describe('AttendanceService - Admin Visibility', () => {
    it('returns scoped daily attendance records for organization', async () => {
      mockPrisma.attendanceRecord.findMany.mockResolvedValue([
        {
          id: 'rec-1',
          employee: { id: 'emp-1', employeeCode: 'EMP-001', fullName: 'Worker One' },
          assignment: {
            site: { id: 'site-1', name: 'Site A' },
            schedule: { id: 'sch-1', name: 'Day Shift' },
          },
          attendanceDate: new Date('2026-09-18T00:00:00.000Z'),
          checkInAt: new Date('2026-09-18T01:00:00.000Z'),
          checkOutAt: new Date('2026-09-18T09:00:00.000Z'),
          status: 'COMPLETED',
          checkInVerification: 'VERIFIED',
          checkOutVerification: 'VERIFIED',
          workDurationMinutes: 480,
        },
      ]);

      const records = await attendanceService.getTodayAttendanceForAdmin('org-tenant-1', {});

      expect(records).toHaveLength(1);
      expect(records[0]!.employee.fullName).toBe('Worker One');
      expect(records[0]!.status).toBe('COMPLETED');
      expect(mockPrisma.attendanceRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-tenant-1',
          }),
        }),
      );
    });

    it('returns detailed record with complete immutable event history', async () => {
      mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
        id: 'rec-1',
        organizationId: 'org-tenant-1',
        employee: { id: 'emp-1', employeeCode: 'EMP-001', fullName: 'Worker One' },
        assignment: {
          site: {
            id: 'site-1',
            name: 'Site A',
            latitude: 11.5564,
            longitude: 104.9282,
            allowedRadiusMeters: 100,
            timezone: 'Asia/Phnom_Penh',
          },
          schedule: { id: 'sch-1', name: 'Day Shift', startTime: '08:00', endTime: '17:00' },
        },
        attendanceDate: new Date('2026-09-18T00:00:00.000Z'),
        checkInAt: new Date('2026-09-18T01:00:00.000Z'),
        checkOutAt: null,
        checkInDistanceMeters: 12.5,
        checkInAccuracyMeters: 10.0,
        checkInVerification: 'VERIFIED',
        status: 'ON_TIME',
        events: [
          {
            id: 'evt-1',
            type: 'CHECK_IN_SUCCESS',
            occurredAt: new Date('2026-09-18T01:00:00.000Z'),
            metadata: { distanceMeters: 12.5, accuracyMeters: 10.0 },
          },
        ],
      });

      const detail = await attendanceService.getAttendanceDetailForAdmin('org-tenant-1', 'rec-1');

      expect(detail.id).toBe('rec-1');
      expect(detail.events).toHaveLength(1);
      expect(detail.events[0]!.type).toBe('CHECK_IN_SUCCESS');
      expect(detail.checkInDistanceMeters).toBe(12.5);
    });

    it('rejects query for record belonging to a different organization (tenant isolation)', async () => {
      mockPrisma.attendanceRecord.findFirst.mockResolvedValue(null);

      await expect(
        attendanceService.getAttendanceDetailForAdmin('org-tenant-1', 'rec-from-tenant-2'),
      ).rejects.toThrow(new NotFoundException('ATTENDANCE_RECORD_NOT_FOUND'));
    });
  });
});
