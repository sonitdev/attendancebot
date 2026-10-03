import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceJobsService } from '../src/jobs/attendance-jobs.service.js';
import type { TelegramNotifierService } from '../src/jobs/telegram-notifier.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('AttendanceJobsService Background Jobs & Reporting', () => {
  let jobsService: AttendanceJobsService;
  let mockPrisma: any;
  let mockTelegramNotifier: any;

  beforeEach(() => {
    mockPrisma = {
      attendanceRecord: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'rec-updated' }),
        create: vi.fn().mockResolvedValue({ id: 'rec-created-1' }),
      },
      assignment: {
        findMany: vi.fn(),
      },
      site: {
        findMany: vi.fn(),
      },
      attendanceEvent: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    };

    mockTelegramNotifier = {
      sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 12345 }),
    };

    jobsService = new AttendanceJobsService(
      mockPrisma as unknown as PrismaService,
      mockTelegramNotifier as unknown as TelegramNotifierService,
    );
  });

  describe('evaluateMissingCheckouts', () => {
    it('flags unclosed shift after schedule end time passes', async () => {
      // Mock open record for today (2026-09-18), shift 08:00 to 17:00, grace 15
      // Current simulated time is 18:00 (11:00 UTC, 18:00 in Asia/Phnom_Penh)
      const simulatedNow = new Date('2026-09-18T11:00:00.000Z');

      mockPrisma.attendanceRecord.findMany.mockResolvedValue([
        {
          id: 'rec-open-1',
          organizationId: 'org-1',
          employeeId: 'emp-1',
          attendanceDate: new Date('2026-09-18T00:00:00.000Z'),
          checkInAt: new Date('2026-09-18T01:05:00.000Z'), // 08:05 local
          checkOutAt: null,
          status: 'ON_TIME',
          employee: {
            fullName: 'Sokha Chan',
            telegramAccount: { telegramUserId: 'tg-worker-1' },
          },
          assignment: {
            siteId: 'site-1',
            site: { name: 'Main Site', timezone: 'Asia/Phnom_Penh' },
            schedule: { endTime: '17:00', graceMinutes: 15 },
          },
        },
      ]);

      const result = await jobsService.evaluateMissingCheckouts('org-1', simulatedNow);

      expect(result.evaluatedCount).toBe(1);
      expect(result.flaggedCount).toBe(1);

      // Verify record was updated to MISSING_CHECKOUT
      expect(mockPrisma.attendanceRecord.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'rec-open-1',
          checkOutAt: null,
          status: { in: ['ON_TIME', 'LATE'] },
        }),
        data: { checkOutStatus: 'MISSING_CHECKOUT', status: 'MISSING_CHECKOUT' },
      });

      // Verify immutable event was created
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attendanceRecordId: 'rec-open-1',
            type: 'CHECK_OUT_ATTEMPT',
          }),
        }),
      );

      // Verify audit log was created
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ATTENDANCE_FLAGGED_MISSING_CHECKOUT',
            targetId: 'rec-open-1',
          }),
        }),
      );

      // Verify Telegram push notification sent
      expect(mockTelegramNotifier.sendMessage).toHaveBeenCalledWith(
        'tg-worker-1',
        expect.any(String),
      );
    });

    it('does not flag shift before schedule end time passes', async () => {
      // Shift ends at 17:00, simulated current time is 14:00 (07:00 UTC)
      const simulatedNow = new Date('2026-09-18T07:00:00.000Z');

      mockPrisma.attendanceRecord.findMany.mockResolvedValue([
        {
          id: 'rec-active-1',
          organizationId: 'org-1',
          employeeId: 'emp-1',
          attendanceDate: new Date('2026-09-18T00:00:00.000Z'),
          checkInAt: new Date('2026-09-18T01:05:00.000Z'),
          checkOutAt: null,
          status: 'ON_TIME',
          employee: {
            telegramAccount: null,
          },
          assignment: {
            siteId: 'site-1',
            site: { name: 'Main Site', timezone: 'Asia/Phnom_Penh' },
            schedule: { endTime: '17:00', graceMinutes: 15 },
          },
        },
      ]);

      const result = await jobsService.evaluateMissingCheckouts('org-1', simulatedNow);

      expect(result.evaluatedCount).toBe(1);
      expect(result.flaggedCount).toBe(0);
      expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
    });
  });

  describe('evaluateAbsences', () => {
    it('records ABSENT for active assignment when check-in window elapsed without record', async () => {
      // Shift starts at 08:00, grace 15, buffer 60 (evaluates after 09:15)
      // Simulated time is 10:00 local (03:00 UTC)
      const simulatedNow = new Date('2026-09-18T03:00:00.000Z');

      mockPrisma.assignment.findMany.mockResolvedValue([
        {
          id: 'assign-1',
          organizationId: 'org-1',
          employeeId: 'emp-1',
          startsOn: new Date('2026-01-01T00:00:00.000Z'),
          endsOn: new Date('2026-12-31T00:00:00.000Z'),
          status: 'ACTIVE',
          site: { id: 'site-1', timezone: 'Asia/Phnom_Penh' },
          schedule: { startTime: '08:00', graceMinutes: 15 },
        },
      ]);

      // No record exists
      mockPrisma.attendanceRecord.findUnique.mockResolvedValue(null);

      const result = await jobsService.evaluateAbsences('org-1', simulatedNow);

      expect(result.evaluatedCount).toBe(1);
      expect(result.absentCount).toBe(1);

      // Verify ABSENT attendance record created
      expect(mockPrisma.attendanceRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          employeeId: 'emp-1',
          assignmentId: 'assign-1',
          status: 'ABSENT',
        }),
      });

      // Verify audit log
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'ATTENDANCE_RECORDED_ABSENT',
        }),
      });
    });

    it('skips assignment if worker already has attendance record for today', async () => {
      const simulatedNow = new Date('2026-09-18T03:00:00.000Z');

      mockPrisma.assignment.findMany.mockResolvedValue([
        {
          id: 'assign-1',
          organizationId: 'org-1',
          employeeId: 'emp-1',
          startsOn: new Date('2026-01-01T00:00:00.000Z'),
          endsOn: null,
          status: 'ACTIVE',
          site: { id: 'site-1', timezone: 'Asia/Phnom_Penh' },
          schedule: { startTime: '08:00', graceMinutes: 15 },
        },
      ]);

      // Existing record present
      mockPrisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'existing-rec',
        status: 'ON_TIME',
      });

      const result = await jobsService.evaluateAbsences('org-1', simulatedNow);

      expect(result.evaluatedCount).toBe(1);
      expect(result.absentCount).toBe(0);
      expect(mockPrisma.attendanceRecord.create).not.toHaveBeenCalled();
    });
  });

  describe('generateDailyReport', () => {
    it('aggregates daily attendance metrics from source records', async () => {
      mockPrisma.site.findMany.mockResolvedValue([
        {
          id: 'site-1',
          name: 'Site A',
          project: { name: 'Tower 1' },
        },
      ]);

      mockPrisma.assignment.findMany.mockResolvedValue([
        { id: 'a1', siteId: 'site-1' },
        { id: 'a2', siteId: 'site-1' },
      ]);

      mockPrisma.attendanceRecord.findMany.mockResolvedValue([
        {
          id: 'r1',
          checkInAt: new Date(),
          status: 'ON_TIME',
          assignment: { siteId: 'site-1' },
        },
        {
          id: 'r2',
          checkInAt: new Date(),
          status: 'LATE',
          assignment: { siteId: 'site-1' },
        },
      ]);

      const report = await jobsService.generateDailyReport('org-1', '2026-09-18');

      expect(report.totalAssignments).toBe(2);
      expect(report.totalPresent).toBe(2);
      expect(report.onTimeCount).toBe(1);
      expect(report.lateCount).toBe(1);
      expect(report.punctualityPercentage).toBe(50);
      expect(report.sitesBreakdown[0].siteName).toBe('Site A');
      expect(report.sitesBreakdown[0].totalExpected).toBe(2);
    });
  });
});
