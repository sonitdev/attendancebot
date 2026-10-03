import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ActiveProjectPreview,
  AttendanceHistoryItem,
  EmployeePerformanceAnalytics,
  ProjectPerformanceSummary,
  WeeklyAttendanceDay,
  WeeklyPerformanceStats,
} from '@workforce/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminDataScope } from '../auth/admin-scope.service.js';

@Injectable()
export class AnalyticsService {
  private readonly cache = new Map<string, { timestamp: number; data: EmployeePerformanceAnalytics }>();
  private readonly TTL_MS = 15_000; // 15 seconds fast cache

  constructor(private readonly prisma: PrismaService) {}

  clearWorkerCache(organizationId: string, employeeId: string): void {
    this.cache.delete(`${organizationId}:${employeeId}`);
  }

  /**
   * Generates cross-project performance analytics for an employee within an organization.
   */
  async getEmployeeAnalytics(
    organizationId: string,
    employeeId: string,
    scope?: AdminDataScope,
  ): Promise<EmployeePerformanceAnalytics> {
    const scopeKey = !scope || scope.unrestricted ? 'all' : `${[...scope.projectIds].sort().join(',')}|${[...scope.siteIds].sort().join(',')}`;
    const cacheKey = `${organizationId}:${employeeId}:${scopeKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.TTL_MS) {
      return cached.data;
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: { telegramAccount: true },
    });

    if (!employee) {
      throw new NotFoundException('EMPLOYEE_NOT_FOUND');
    }

    const [records, activeAssignment] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          organizationId,
          employeeId,
          checkInAt: { not: null },
          ...(!scope || scope.unrestricted ? {} : { OR: [{ projectId: { in: scope.projectIds } }, { adjustedProjectId: { in: scope.projectIds } }, { siteId: { in: scope.siteIds } }] }),
        },
        take: 100,
        include: {
          project: true,
          adjustedProject: true,
          site: true,
          assignment: {
            include: {
              site: {
                include: {
                  project: true,
                },
              },
              schedule: true,
            },
          },
        },
        orderBy: { attendanceDate: 'desc' },
      }),
      this.prisma.assignment?.findFirst
        ? this.prisma.assignment.findFirst({
            where: {
              employeeId,
              organizationId,
              status: 'ACTIVE',
              ...(!scope || scope.unrestricted ? {} : { site: { OR: [{ projectId: { in: scope.projectIds } }, { id: { in: scope.siteIds } }] } }),
            },
            include: {
              site: {
                include: {
                  project: true,
                },
              },
              schedule: true,
            },
            orderBy: { startsOn: 'desc' },
          })
        : Promise.resolve(null),
    ]);

    const totalShifts = records.length;
    const totalWorkMinutes = records.reduce((acc, r) => acc + (r.workDurationMinutes ?? 0), 0);
    const totalWorkHours = Math.round((totalWorkMinutes / 60) * 10) / 10;

    const onTimeCount = records.filter((r) => {
      const status = r.adjustedStatus ?? r.checkInStatus ?? r.status;
      return status === 'ON_TIME';
    }).length;
    const lateCount = records.filter((r) => (r.adjustedStatus ?? r.checkInStatus ?? r.status) === 'LATE').length;
    const onTimePercentage = totalShifts > 0 ? Math.round((onTimeCount / totalShifts) * 100) : 100;

    const verifiedCount = records.filter((r) => r.checkInVerification === 'VERIFIED').length;
    const exceptionCount = records.filter((r) => r.checkInVerification && r.checkInVerification !== 'VERIFIED').length;

    // Aggregate by project
    const projectMap = new Map<
      string,
      {
        project: { id: string; code: string; name: string };
        records: typeof records;
      }
    >();

    for (const record of records) {
      const project = record.adjustedProject ?? record.project;
      if (!project) continue;
      if (!projectMap.has(project.id)) {
        projectMap.set(project.id, { project, records: [] });
      }
      projectMap.get(project.id)!.records.push(record);
    }

    const projectBreakdown: ProjectPerformanceSummary[] = Array.from(projectMap.values()).map(
      ({ project, records: pRecords }) => {
        const pMinutes = pRecords.reduce((acc, r) => acc + (r.workDurationMinutes ?? 0), 0);
        const pOnTime = pRecords.filter((r) => {
          const status = r.adjustedStatus ?? r.checkInStatus ?? r.status;
          return status === 'ON_TIME';
        }).length;
        const pTotal = pRecords.length;

        return {
          projectId: project.id,
          projectCode: project.code,
          projectName: project.name,
          shiftsCompleted: pTotal,
          totalWorkMinutes: pMinutes,
          totalWorkHours: Math.round((pMinutes / 60) * 10) / 10,
          onTimePercentage: pTotal > 0 ? Math.round((pOnTime / pTotal) * 100) : 100,
          lastAttendedDate: pRecords[0]?.attendanceDate ? pRecords[0].attendanceDate.toISOString().slice(0, 10) : null,
        };
      },
    );

    const recentHistory: AttendanceHistoryItem[] = records.slice(0, 30).map((r) => ({
      id: r.id,
      attendanceDate: r.attendanceDate ? r.attendanceDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      projectName: (r.adjustedProject ?? r.project)?.name ?? 'Site Project',
      siteName: r.assignment?.site?.name ?? 'Work Site',
      checkInAt: (r.adjustedCheckInAt ?? r.checkInAt)?.toISOString() ?? null,
      checkOutAt: (r.adjustedCheckOutAt ?? r.checkOutAt)?.toISOString() ?? null,
      status: r.adjustedStatus ?? r.status,
      verification: r.checkInVerification,
      workDurationMinutes: r.workDurationMinutes,
    }));

    // Active project preview
    const activeProject: ActiveProjectPreview | undefined = (activeAssignment?.site?.project && activeAssignment?.schedule)
      ? {
          projectId: activeAssignment.site.project.id,
          projectCode: activeAssignment.site.project.code,
          projectName: activeAssignment.site.project.name,
          siteName: activeAssignment.site.name,
          allowedRadiusMeters: activeAssignment.site.allowedRadiusMeters,
          scheduleTime: `${activeAssignment.schedule.startTime} - ${activeAssignment.schedule.endTime}`,
          startsOn: activeAssignment.startsOn ? activeAssignment.startsOn.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        }
      : undefined;

    // Calculate 7 days of the current week (Monday to Sunday)
    const siteTimezone = activeAssignment?.site?.timezone || 'Asia/Phnom_Penh';
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: siteTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = formatter.format(now);
    const todayDate = new Date(`${todayStr}T00:00:00.000Z`);
    const dayOfWeek = todayDate.getUTCDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const daysOfWeekNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weeklyAttendance: WeeklyAttendanceDay[] = [];

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(todayDate);
      dayDate.setUTCDate(todayDate.getUTCDate() + mondayOffset + i);
      const dateStr = dayDate.toISOString().slice(0, 10);
      const dayName = daysOfWeekNames[i]!;
      const dayNumber = dayDate.getUTCDate();
      const isToday = dateStr === todayStr;

      const rec = records.find((r) => r.attendanceDate && r.attendanceDate.toISOString().slice(0, 10) === dateStr);

      if (rec) {
        const hours = rec.workDurationMinutes ? Math.round((rec.workDurationMinutes / 60) * 10) / 10 : 0;
        weeklyAttendance.push({
          date: dateStr,
          dayName,
          dayNumber,
          hoursWorked: hours,
          targetHours: 8.0,
          status: rec.adjustedStatus ?? rec.status,
          checkInAt: (rec.adjustedCheckInAt ?? rec.checkInAt)?.toISOString() ?? null,
          checkOutAt: (rec.adjustedCheckOutAt ?? rec.checkOutAt)?.toISOString() ?? null,
          isToday,
        });
      } else {
        const isPast = dateStr < todayStr;
        weeklyAttendance.push({
          date: dateStr,
          dayName,
          dayNumber,
          hoursWorked: 0,
          targetHours: 8.0,
          status: isPast ? 'OFF' : isToday ? 'NOT_STARTED' : 'PENDING',
          checkInAt: null,
          checkOutAt: null,
          isToday,
        });
      }
    }

    const weekShifts = weeklyAttendance.filter((d) => d.checkInAt !== null);
    const weeklyTotalHours = Math.round(weekShifts.reduce((acc, d) => acc + d.hoursWorked, 0) * 10) / 10;
    const weeklyOnTime = weekShifts.filter((d) => d.status !== 'LATE').length;
    const weeklyOnTimeRate = weekShifts.length > 0 ? Math.round((weeklyOnTime / weekShifts.length) * 100) : 100;

    const weeklyStats: WeeklyPerformanceStats = {
      totalHours: weeklyTotalHours,
      targetHours: 40.0,
      onTimeRate: weeklyOnTimeRate,
      shiftsCount: weekShifts.length,
    };

    const result: EmployeePerformanceAnalytics = {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        jobTitle: employee.jobTitle,
        avatarUrl: employee.avatarUrl ?? employee.telegramAccount?.photoUrl ?? null,
        telegramUsername: employee.telegramAccount?.username ?? null,
      },
      summary: {
        totalShifts,
        totalWorkMinutes,
        totalWorkHours,
        onTimeCount,
        lateCount,
        onTimePercentage,
        verifiedCount,
        exceptionCount,
      },
      projectBreakdown,
      recentHistory,
      weeklyAttendance,
      weeklyStats,
      activeProject,
    };

    this.cache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  }

  /**
   * Retrieves complete historical attendance timeline for a worker across projects.
   */
  async getEmployeeAttendanceHistory(
    organizationId: string,
    employeeId: string,
    limit = 50,
    scope?: AdminDataScope,
  ): Promise<AttendanceHistoryItem[]> {
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        organizationId,
        employeeId,
        ...(!scope || scope.unrestricted ? {} : { OR: [{ projectId: { in: scope.projectIds } }, { adjustedProjectId: { in: scope.projectIds } }, { siteId: { in: scope.siteIds } }] }),
      },
      include: {
        project: true,
        adjustedProject: true,
        site: true,
      },
      orderBy: { attendanceDate: 'desc' },
      take: limit,
    });

    return records.map((r) => ({
      id: r.id,
      attendanceDate: r.attendanceDate ? r.attendanceDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      projectName: (r.adjustedProject ?? r.project)?.name ?? r.site?.name ?? 'Site Project',
      siteName: r.site?.name ?? 'Work Site',
      checkInAt: (r.adjustedCheckInAt ?? r.checkInAt)?.toISOString() ?? null,
      checkOutAt: (r.adjustedCheckOutAt ?? r.checkOutAt)?.toISOString() ?? null,
      status: r.adjustedStatus ?? r.status,
      verification: r.checkInVerification,
      workDurationMinutes: r.workDurationMinutes,
    }));
  }
}
