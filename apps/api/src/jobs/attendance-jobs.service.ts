import { Injectable, Logger } from '@nestjs/common';
import { km } from '@workforce/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramNotifierService } from './telegram-notifier.service.js';
import {
  getSiteDate,
  getSiteTimeMinutes,
  parseTimeToMinutes,
} from '../attendance/schedule-evaluator.js';

export interface DailyOperationalReport {
  organizationId: string;
  reportDate: string;
  totalAssignments: number;
  totalPresent: number;
  onTimeCount: number;
  lateCount: number;
  completedCount: number;
  earlyCheckoutCount: number;
  missingCheckoutCount: number;
  absentCount: number;
  punctualityPercentage: number;
  sitesBreakdown: Array<{
    siteId: string;
    siteName: string;
    projectName: string;
    totalExpected: number;
    presentCount: number;
    onTimeCount: number;
    lateCount: number;
    missingCheckoutCount: number;
  }>;
}

@Injectable()
export class AttendanceJobsService {
  private readonly logger = new Logger(AttendanceJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramNotifier: TelegramNotifierService,
  ) {}

  /**
   * Scans for open attendance records where the shift ended without a check-out.
   * Marks them MISSING_CHECKOUT and appends an immutable AttendanceEvent and AuditLog.
   */
  async evaluateMissingCheckouts(organizationId?: string, now = new Date()): Promise<{
    evaluatedCount: number;
    flaggedCount: number;
  }> {
    const openRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        checkInAt: { not: null },
        checkOutAt: null,
        status: { in: ['ON_TIME', 'LATE'] },
      },
      include: {
        employee: {
          include: { telegramAccount: true },
        },
        assignment: {
          include: {
            site: true,
            schedule: true,
          },
        },
      },
    });

    let flaggedCount = 0;

    for (const record of openRecords) {
      const siteTz = record.assignment.site.timezone;
      const recordDateStr = record.attendanceDate.toISOString().slice(0, 10);
      const currentDateStr = getSiteDate(now, siteTz);
      const currentMinutes = getSiteTimeMinutes(now, siteTz);
      const endMinutes = parseTimeToMinutes(record.assignment.schedule.endTime);
      const grace = record.assignment.schedule.graceMinutes || 0;

      const isShiftEnded =
        currentDateStr > recordDateStr ||
        (currentDateStr === recordDateStr && currentMinutes > endMinutes + grace);

      if (isShiftEnded) {
        const claimed = await this.prisma.$transaction(async (tx) => {
          // Multiple job runners may evaluate the same record concurrently.
          // Only the runner that wins this conditional transition may notify.
          const transition = await tx.attendanceRecord.updateMany({
            where: {
              id: record.id,
              checkInAt: { not: null },
              checkOutAt: null,
              status: { in: ['ON_TIME', 'LATE'] },
            },
            data: { checkOutStatus: 'MISSING_CHECKOUT', status: 'MISSING_CHECKOUT' },
          });
          if (transition.count !== 1) return false;

          await tx.attendanceEvent.create({
            data: {
              organizationId: record.organizationId,
              attendanceRecordId: record.id,
              type: 'CHECK_OUT_ATTEMPT',
              metadata: {
                action: 'MISSING_CHECKOUT_FLAGGED',
                reason: `Automated job flagged missing check-out: shift ended at ${record.assignment.schedule.endTime} without check-out`,
              },
            },
          });

          await tx.auditLog.create({
            data: {
              organizationId: record.organizationId,
              action: 'ATTENDANCE_FLAGGED_MISSING_CHECKOUT',
              targetType: 'AttendanceRecord',
              targetId: record.id,
              metadata: {
                employeeId: record.employeeId,
                scheduleEndTime: record.assignment.schedule.endTime,
                siteId: record.assignment.siteId,
              },
            },
          });

          return true;
        });

        if (!claimed) continue;

        flaggedCount++;

        // Send push notification if Telegram account is linked
        if (record.employee.telegramAccount?.telegramUserId) {
          await this.telegramNotifier.sendMessage(
            record.employee.telegramAccount.telegramUserId,
            km.telegram.missingCheckoutNotice(record.assignment.site.name, record.assignment.schedule.endTime),
          );
        }
      }
    }

    this.logger.log(
      `Missing checkout evaluation complete: ${openRecords.length} open shifts evaluated, ${flaggedCount} flagged.`,
    );

    return {
      evaluatedCount: openRecords.length,
      flaggedCount,
    };
  }

  /**
   * Scans active assignments for workers who did not check in within schedule start + grace + buffer.
   * Records ABSENT status with immutable event and audit log.
   */
  async evaluateAbsences(organizationId?: string, now = new Date()): Promise<{
    evaluatedCount: number;
    absentCount: number;
  }> {
    const activeAssignments = await this.prisma.assignment.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        status: 'ACTIVE',
      },
      include: {
        employee: true,
        site: true,
        schedule: true,
      },
    });

    let absentCount = 0;

    for (const assignment of activeAssignments) {
      const siteTz = assignment.site.timezone;
      const currentDateStr = getSiteDate(now, siteTz);
      const currentDate = new Date(`${currentDateStr}T00:00:00.000Z`);

      const startsOnStr = assignment.startsOn.toISOString().slice(0, 10);
      const endsOnStr = assignment.endsOn ? assignment.endsOn.toISOString().slice(0, 10) : null;

      // Check if assignment is active on this local date
      if (currentDateStr < startsOnStr || (endsOnStr && currentDateStr > endsOnStr)) {
        continue;
      }

      const currentMinutes = getSiteTimeMinutes(now, siteTz);
      const startMinutes = parseTimeToMinutes(assignment.schedule.startTime);
      const grace = assignment.schedule.graceMinutes || 0;
      const bufferMinutes = 60; // 1 hour after grace period

      // If current local time has passed start + grace + buffer
      if (currentMinutes > startMinutes + grace + bufferMinutes) {
        // Check if attendance already recorded today
        const existingRecord = await this.prisma.attendanceRecord.findUnique({
          where: {
            assignmentId_attendanceDate: {
              assignmentId: assignment.id,
              attendanceDate: currentDate,
            },
          },
        });

        if (!existingRecord) {
          await this.prisma.$transaction(async (tx) => {
            const record = await tx.attendanceRecord.create({
              data: {
                organizationId: assignment.organizationId,
                employeeId: assignment.employeeId,
                assignmentId: assignment.id,
                projectId: assignment.site.projectId,
                siteId: assignment.siteId,
                attendanceDate: currentDate,
                checkInStatus: 'ABSENT',
                status: 'ABSENT',
              },
            });

            await tx.attendanceEvent.create({
              data: {
                organizationId: assignment.organizationId,
                attendanceRecordId: record.id,
                type: 'CHECK_IN_ATTEMPT',
                metadata: {
                  action: 'ABSENT_RECORDED',
                  reason: `Automated job recorded absence: shift started at ${assignment.schedule.startTime}, no check-in recorded within grace window`,
                },
              },
            });

            await tx.auditLog.create({
              data: {
                organizationId: assignment.organizationId,
                action: 'ATTENDANCE_RECORDED_ABSENT',
                targetType: 'AttendanceRecord',
                targetId: record.id,
                metadata: {
                  employeeId: assignment.employeeId,
                  siteId: assignment.siteId,
                  scheduleStartTime: assignment.schedule.startTime,
                },
              },
            });
          });

          absentCount++;
        }
      }
    }

    this.logger.log(
      `Absence evaluation complete: ${activeAssignments.length} assignments evaluated, ${absentCount} recorded absent.`,
    );

    return {
      evaluatedCount: activeAssignments.length,
      absentCount,
    };
  }

  /**
   * Sends shift start reminders to workers whose shift starts within 30 minutes.
   */
  async sendShiftReminders(organizationId?: string, now = new Date()): Promise<{
    remindersSent: number;
  }> {
    const activeAssignments = await this.prisma.assignment.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        status: 'ACTIVE',
        employee: {
          telegramAccount: {
            isNot: null,
          },
        },
      },
      include: {
        employee: {
          include: { telegramAccount: true },
        },
        site: true,
        schedule: true,
      },
    });

    let remindersSent = 0;

    for (const assignment of activeAssignments) {
      const siteTz = assignment.site.timezone;
      const currentDateStr = getSiteDate(now, siteTz);
      const startsOnStr = assignment.startsOn.toISOString().slice(0, 10);
      const endsOnStr = assignment.endsOn ? assignment.endsOn.toISOString().slice(0, 10) : null;

      if (currentDateStr < startsOnStr || (endsOnStr && currentDateStr > endsOnStr)) {
        continue;
      }

      const currentMinutes = getSiteTimeMinutes(now, siteTz);
      const startMinutes = parseTimeToMinutes(assignment.schedule.startTime);
      const minutesUntilStart = startMinutes - currentMinutes;

      // Remind if shift starts between 5 and 35 minutes from now
      if (minutesUntilStart >= 5 && minutesUntilStart <= 35) {
        const tgUserId = assignment.employee.telegramAccount?.telegramUserId;
        if (tgUserId) {
          const res = await this.telegramNotifier.sendMessage(
            tgUserId,
            km.telegram.shiftReminder(assignment.site.name, assignment.schedule.startTime),
          );
          if (res.success) {
            remindersSent++;
          }
        }
      }
    }

    this.logger.log(`Shift reminders complete: ${remindersSent} notifications sent.`);

    return { remindersSent };
  }

  /**
   * Generates authoritative daily operational report derived from source records.
   */
  async generateDailyReport(
    organizationId: string,
    dateStr?: string,
    now = new Date(),
  ): Promise<DailyOperationalReport> {
    const reportDateStr = dateStr || getSiteDate(now, 'Asia/Phnom_Penh');
    const targetDate = new Date(`${reportDateStr}T00:00:00.000Z`);

    const [sites, assignments, attendanceRecords] = await Promise.all([
      this.prisma.site.findMany({
        where: { organizationId },
        include: { project: true },
      }),
      this.prisma.assignment.findMany({
        where: {
          organizationId,
          startsOn: { lte: targetDate },
          OR: [{ endsOn: null }, { endsOn: { gte: targetDate } }],
          status: 'ACTIVE',
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: {
          organizationId,
          attendanceDate: targetDate,
        },
        include: {
          assignment: {
            include: { site: true },
          },
        },
      }),
    ]);

    const totalAssignments = assignments.length;
    let onTimeCount = 0;
    let lateCount = 0;
    let completedCount = 0;
    let earlyCheckoutCount = 0;
    let missingCheckoutCount = 0;
    let absentCount = 0;
    let totalPresent = 0;

    for (const record of attendanceRecords) {
      const effectiveCheckIn = record.adjustedCheckInAt ?? record.checkInAt;
      const effectiveStatus = record.adjustedStatus ?? record.status;
      const arrivalStatus = record.adjustedStatus ?? record.checkInStatus ?? record.status;
      if (effectiveCheckIn) {
        totalPresent++;
      }
      if (arrivalStatus === 'ON_TIME') {
        onTimeCount++;
      }
      if (arrivalStatus === 'LATE') {
        lateCount++;
      }
      if (effectiveStatus === 'COMPLETED') {
        completedCount++;
      }
      if (effectiveStatus === 'EARLY_CHECKOUT') {
        earlyCheckoutCount++;
      }
      if (effectiveStatus === 'MISSING_CHECKOUT') {
        missingCheckoutCount++;
      }
      if (effectiveStatus === 'ABSENT') {
        absentCount++;
      }
    }

    const punctualityPercentage =
      totalPresent > 0 ? Math.round((onTimeCount / totalPresent) * 100) : 100;

    const sitesBreakdown = sites.map((site) => {
      const siteAssignments = assignments.filter((a) => a.siteId === site.id);
      const siteRecords = attendanceRecords.filter((r) => r.siteId === site.id);

      const sitePresent = siteRecords.filter((r) => r.adjustedCheckInAt ?? r.checkInAt).length;
      const siteOnTime = siteRecords.filter(
        (r) => {
          const status = r.adjustedStatus ?? r.checkInStatus ?? r.status;
          const checkInAt = r.adjustedCheckInAt ?? r.checkInAt;
          return Boolean(checkInAt && status === 'ON_TIME');
        },
      ).length;
      const siteLate = siteRecords.filter((r) => (r.adjustedStatus ?? r.checkInStatus ?? r.status) === 'LATE').length;
      const siteMissingCheckout = siteRecords.filter(
        (r) => (r.adjustedStatus ?? r.status) === 'MISSING_CHECKOUT',
      ).length;

      return {
        siteId: site.id,
        siteName: site.name,
        projectName: site.project.name,
        totalExpected: siteAssignments.length,
        presentCount: sitePresent,
        onTimeCount: siteOnTime,
        lateCount: siteLate,
        missingCheckoutCount: siteMissingCheckout,
      };
    });

    return {
      organizationId,
      reportDate: reportDateStr,
      totalAssignments,
      totalPresent,
      onTimeCount,
      lateCount,
      completedCount,
      earlyCheckoutCount,
      missingCheckoutCount,
      absentCount,
      punctualityPercentage,
      sitesBreakdown,
    };
  }
}
