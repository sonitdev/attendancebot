import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AttendanceExceptionItem,
  AttendanceExportQuery,
  AttendanceExportRow,
  AttendanceCorrectionItem,
  CreateCorrectionInput,
  ResolveCorrectionInput,
} from '@workforce/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatSiteDateTime(utcDate: Date | null, timeZone: string): string {
  if (!utcDate) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(utcDate)
      .replace(',', '');
  } catch {
    return utcDate.toISOString();
  }
}

@Injectable()
export class CorrectionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists attendance exceptions: non-standard statuses or records with pending corrections.
   */
  async listExceptions(
    organizationId: string,
    query?: { siteId?: string; projectId?: string; status?: string },
  ): Promise<AttendanceExceptionItem[]> {
    const where: Prisma.AttendanceRecordWhereInput = {
      organizationId,
      ...(query?.siteId ? { assignment: { siteId: query.siteId } } : {}),
      ...(query?.projectId ? { assignment: { site: { projectId: query.projectId } } } : {}),
      ...(query?.status
        ? { status: query.status as any }
        : {
            OR: [
              {
                status: {
                  in: [
                    'MISSING_CHECKOUT',
                    'OUTSIDE_GEOFENCE',
                    'LOW_ACCURACY',
                    'LATE',
                    'PENDING_REVIEW',
                    'ABSENT',
                  ],
                },
              },
              {
                corrections: {
                  some: {
                    status: 'PENDING',
                  },
                },
              },
            ],
          }),
    };

    const records = await this.prisma.attendanceRecord.findMany({
      where,
      take: 100,
      orderBy: { attendanceDate: 'desc' },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            avatarUrl: true,
          },
        },
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
        corrections: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return records.map((rec) => ({
      id: rec.id,
      attendanceDate: rec.attendanceDate.toISOString().slice(0, 10),
      employee: {
        id: rec.employee.id,
        employeeCode: rec.employee.employeeCode,
        fullName: rec.employee.fullName,
        avatarUrl: rec.employee.avatarUrl,
      },
      site: {
        id: rec.assignment.site.id,
        name: rec.assignment.site.name,
        timezone: rec.assignment.site.timezone,
      },
      project: {
        id: rec.assignment.site.project.id,
        name: rec.assignment.site.project.name,
        code: rec.assignment.site.project.code,
      },
      schedule: {
        name: rec.assignment.schedule.name,
        startTime: rec.assignment.schedule.startTime,
        endTime: rec.assignment.schedule.endTime,
      },
      status: rec.status,
      checkInAt: rec.checkInAt ? rec.checkInAt.toISOString() : null,
      checkOutAt: rec.checkOutAt ? rec.checkOutAt.toISOString() : null,
      checkInLatitude: rec.checkInLatitude ? Number(rec.checkInLatitude) : null,
      checkInLongitude: rec.checkInLongitude ? Number(rec.checkInLongitude) : null,
      checkInAccuracyMeters: rec.checkInAccuracyMeters ? Number(rec.checkInAccuracyMeters) : null,
      checkInDistanceMeters: rec.checkInDistanceMeters ? Number(rec.checkInDistanceMeters) : null,
      checkInVerification: rec.checkInVerification,
      checkOutDistanceMeters: rec.checkOutDistanceMeters ? Number(rec.checkOutDistanceMeters) : null,
      workDurationMinutes: rec.workDurationMinutes,
      corrections: rec.corrections.map((c) => ({
        id: c.id,
        attendanceRecordId: c.attendanceRecordId,
        employeeId: rec.employee.id,
        employeeName: rec.employee.fullName,
        employeeCode: rec.employee.employeeCode,
        siteName: rec.assignment.site.name,
        attendanceDate: rec.attendanceDate.toISOString().slice(0, 10),
        originalCheckInAt: rec.checkInAt ? rec.checkInAt.toISOString() : null,
        originalCheckOutAt: rec.checkOutAt ? rec.checkOutAt.toISOString() : null,
        originalStatus: rec.status,
        status: c.status,
        reason: c.reason,
        correctedCheckInAt: c.correctedCheckInAt ? c.correctedCheckInAt.toISOString() : null,
        correctedCheckOutAt: c.correctedCheckOutAt ? c.correctedCheckOutAt.toISOString() : null,
        correctedStatus: c.correctedStatus,
        requestedByUserId: c.requestedByUserId,
        approvedByUserId: c.approvedByUserId,
        createdAt: c.createdAt.toISOString(),
        resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
      })),
    }));
  }

  /**
   * Proposes a formal attendance correction with mandatory justification.
   * Original GPS evidence and raw timestamps remain permanently unaltered.
   */
  async createCorrection(
    organizationId: string,
    recordId: string,
    input: CreateCorrectionInput,
    actorUserId?: string,
  ): Promise<AttendanceCorrectionItem> {
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id: recordId, organizationId },
      include: {
        employee: true,
        assignment: {
          include: {
            site: true,
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundException('ATTENDANCE_RECORD_NOT_FOUND');
    }

    const correctedCheckInAt = input.correctedCheckInAt ? new Date(input.correctedCheckInAt) : null;
    const correctedCheckOutAt = input.correctedCheckOutAt ? new Date(input.correctedCheckOutAt) : null;

    if (correctedCheckInAt && isNaN(correctedCheckInAt.getTime())) {
      throw new BadRequestException('INVALID_CHECK_IN_DATE');
    }
    if (correctedCheckOutAt && isNaN(correctedCheckOutAt.getTime())) {
      throw new BadRequestException('INVALID_CHECK_OUT_DATE');
    }

    return this.prisma.$transaction(async (tx) => {
      const correction = await tx.attendanceCorrection.create({
        data: {
          organizationId,
          attendanceRecordId: record.id,
          requestedByUserId: actorUserId,
          status: 'PENDING',
          reason: input.reason.trim(),
          correctedCheckInAt,
          correctedCheckOutAt,
          correctedStatus: input.correctedStatus,
        },
      });

      await tx.attendanceEvent.create({
        data: {
          organizationId,
          attendanceRecordId: record.id,
          type: 'MANUAL_CORRECTION',
          metadata: {
            action: 'CORRECTION_PROPOSED',
            correctionId: correction.id,
            reason: input.reason.trim(),
            proposedStatus: input.correctedStatus,
            proposedCheckInAt: input.correctedCheckInAt,
            proposedCheckOutAt: input.correctedCheckOutAt,
            requestedByUserId: actorUserId,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: 'CORRECTION_PROPOSED',
          targetType: 'AttendanceRecord',
          targetId: record.id,
          metadata: {
            correctionId: correction.id,
            reason: input.reason.trim(),
          },
        },
      });

      return {
        id: correction.id,
        attendanceRecordId: record.id,
        employeeId: record.employee.id,
        employeeName: record.employee.fullName,
        employeeCode: record.employee.employeeCode,
        siteName: record.assignment.site.name,
        attendanceDate: record.attendanceDate.toISOString().slice(0, 10),
        originalCheckInAt: record.checkInAt ? record.checkInAt.toISOString() : null,
        originalCheckOutAt: record.checkOutAt ? record.checkOutAt.toISOString() : null,
        originalStatus: record.status,
        status: correction.status,
        reason: correction.reason,
        correctedCheckInAt: correction.correctedCheckInAt ? correction.correctedCheckInAt.toISOString() : null,
        correctedCheckOutAt: correction.correctedCheckOutAt ? correction.correctedCheckOutAt.toISOString() : null,
        correctedStatus: correction.correctedStatus,
        requestedByUserId: correction.requestedByUserId,
        approvedByUserId: correction.approvedByUserId,
        createdAt: correction.createdAt.toISOString(),
        resolvedAt: correction.resolvedAt ? correction.resolvedAt.toISOString() : null,
      };
    });
  }

  /**
   * Approves or rejects an attendance correction.
   * If approved: updates record status/duration, creates MANAGER_OVERRIDE event and audit log.
   * If rejected: preserves original record intact, records resolution in audit log.
   * Rule 7: GPS coordinates and physical evidence are never overwritten.
   */
  async resolveCorrection(
    organizationId: string,
    correctionId: string,
    input: ResolveCorrectionInput,
    actorUserId: string,
  ): Promise<AttendanceCorrectionItem> {
    const correction = await this.prisma.attendanceCorrection.findFirst({
      where: { id: correctionId, organizationId },
      include: {
        attendanceRecord: {
          include: {
            employee: true,
            assignment: {
              include: {
                site: true,
              },
            },
          },
        },
      },
    });

    if (!correction) {
      throw new NotFoundException('CORRECTION_NOT_FOUND');
    }

    if (correction.status !== 'PENDING') {
      throw new ConflictException('CORRECTION_ALREADY_RESOLVED');
    }

    const record = correction.attendanceRecord;
    const resolvedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      if (input.approved) {
        const updatedCorrection = await tx.attendanceCorrection.update({
          where: { id: correction.id },
          data: {
            status: 'APPROVED',
            approvedByUserId: actorUserId,
            resolvedAt,
          },
        });

        const effectiveCheckInAt = correction.correctedCheckInAt ?? record.checkInAt;
        const effectiveCheckOutAt = correction.correctedCheckOutAt ?? record.checkOutAt;
        let workDurationMinutes = record.workDurationMinutes;
        if (effectiveCheckInAt && effectiveCheckOutAt) {
          workDurationMinutes = Math.max(
            0,
            Math.round((effectiveCheckOutAt.getTime() - effectiveCheckInAt.getTime()) / 60_000),
          );
        }

        // Apply correction to record without altering GPS evidence
        await tx.attendanceRecord.update({
          where: { id: record.id },
          data: {
            ...(correction.correctedStatus ? { status: correction.correctedStatus } : {}),
            ...(correction.correctedCheckInAt ? { checkInAt: correction.correctedCheckInAt } : {}),
            ...(correction.correctedCheckOutAt ? { checkOutAt: correction.correctedCheckOutAt } : {}),
            workDurationMinutes,
          },
        });

        await tx.attendanceEvent.create({
          data: {
            organizationId,
            attendanceRecordId: record.id,
            type: 'MANAGER_OVERRIDE',
            metadata: {
              action: 'CORRECTION_APPROVED',
              correctionId: correction.id,
              reason: correction.reason,
              resolutionNote: input.note,
              approvedByUserId: actorUserId,
              newStatus: correction.correctedStatus,
            },
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: 'CORRECTION_APPROVED',
            targetType: 'AttendanceRecord',
            targetId: record.id,
            metadata: {
              correctionId: correction.id,
              reason: correction.reason,
              note: input.note,
            },
          },
        });

        return {
          id: updatedCorrection.id,
          attendanceRecordId: record.id,
          employeeId: record.employee.id,
          employeeName: record.employee.fullName,
          employeeCode: record.employee.employeeCode,
          siteName: record.assignment.site.name,
          attendanceDate: record.attendanceDate.toISOString().slice(0, 10),
          originalCheckInAt: record.checkInAt ? record.checkInAt.toISOString() : null,
          originalCheckOutAt: record.checkOutAt ? record.checkOutAt.toISOString() : null,
          originalStatus: record.status,
          status: 'APPROVED' as const,
          reason: updatedCorrection.reason,
          correctedCheckInAt: updatedCorrection.correctedCheckInAt ? updatedCorrection.correctedCheckInAt.toISOString() : null,
          correctedCheckOutAt: updatedCorrection.correctedCheckOutAt ? updatedCorrection.correctedCheckOutAt.toISOString() : null,
          correctedStatus: updatedCorrection.correctedStatus,
          requestedByUserId: updatedCorrection.requestedByUserId,
          approvedByUserId: updatedCorrection.approvedByUserId,
          createdAt: updatedCorrection.createdAt.toISOString(),
          resolvedAt: resolvedAt.toISOString(),
        };
      } else {
        const updatedCorrection = await tx.attendanceCorrection.update({
          where: { id: correction.id },
          data: {
            status: 'REJECTED',
            approvedByUserId: actorUserId,
            resolvedAt,
          },
        });

        await tx.attendanceEvent.create({
          data: {
            organizationId,
            attendanceRecordId: record.id,
            type: 'MANAGER_OVERRIDE',
            metadata: {
              action: 'CORRECTION_REJECTED',
              correctionId: correction.id,
              reason: correction.reason,
              resolutionNote: input.note,
              rejectedByUserId: actorUserId,
            },
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: 'CORRECTION_REJECTED',
            targetType: 'AttendanceRecord',
            targetId: record.id,
            metadata: {
              correctionId: correction.id,
              note: input.note,
            },
          },
        });

        return {
          id: updatedCorrection.id,
          attendanceRecordId: record.id,
          employeeId: record.employee.id,
          employeeName: record.employee.fullName,
          employeeCode: record.employee.employeeCode,
          siteName: record.assignment.site.name,
          attendanceDate: record.attendanceDate.toISOString().slice(0, 10),
          originalCheckInAt: record.checkInAt ? record.checkInAt.toISOString() : null,
          originalCheckOutAt: record.checkOutAt ? record.checkOutAt.toISOString() : null,
          originalStatus: record.status,
          status: 'REJECTED' as const,
          reason: updatedCorrection.reason,
          correctedCheckInAt: updatedCorrection.correctedCheckInAt ? updatedCorrection.correctedCheckInAt.toISOString() : null,
          correctedCheckOutAt: updatedCorrection.correctedCheckOutAt ? updatedCorrection.correctedCheckOutAt.toISOString() : null,
          correctedStatus: updatedCorrection.correctedStatus,
          requestedByUserId: updatedCorrection.requestedByUserId,
          approvedByUserId: updatedCorrection.approvedByUserId,
          createdAt: updatedCorrection.createdAt.toISOString(),
          resolvedAt: resolvedAt.toISOString(),
        };
      }
    });
  }

  /**
   * Exports attendance records formatted in the site's IANA timezone.
   * Supports CSV (RFC 4180) and JSON formats.
   */
  async exportAttendanceRecords(
    organizationId: string,
    query: AttendanceExportQuery,
  ): Promise<{ format: 'csv' | 'json'; data: string | AttendanceExportRow[] }> {
    const where: Prisma.AttendanceRecordWhereInput = {
      organizationId,
      ...(query.startDate || query.endDate
        ? {
            attendanceDate: {
              ...(query.startDate ? { gte: new Date(`${query.startDate}T00:00:00.000Z`) } : {}),
              ...(query.endDate ? { lte: new Date(`${query.endDate}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(query.siteId ? { assignment: { siteId: query.siteId } } : {}),
      ...(query.projectId ? { assignment: { site: { projectId: query.projectId } } } : {}),
    };

    const records = await this.prisma.attendanceRecord.findMany({
      where,
      orderBy: { attendanceDate: 'desc' },
      include: {
        employee: true,
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
        corrections: {
          select: { id: true },
        },
      },
    });

    const rows: AttendanceExportRow[] = records.map((r) => {
      const siteTz = r.assignment.site.timezone;
      const minutes = r.workDurationMinutes ?? 0;
      const hours = Math.floor(minutes / 60);
      const remMinutes = minutes % 60;
      return {
        recordId: r.id,
        attendanceDate: r.attendanceDate.toISOString().slice(0, 10),
        employeeCode: r.employee.employeeCode,
        employeeName: r.employee.fullName,
        projectCode: r.assignment.site.project.code,
        projectName: r.assignment.site.project.name,
        siteName: r.assignment.site.name,
        siteTimezone: siteTz,
        scheduledStart: r.assignment.schedule.startTime,
        scheduledEnd: r.assignment.schedule.endTime,
        checkInLocalTime: formatSiteDateTime(r.checkInAt, siteTz),
        checkOutLocalTime: formatSiteDateTime(r.checkOutAt, siteTz),
        workDurationMinutes: r.workDurationMinutes,
        workHoursFormatted: `${hours}h ${remMinutes}m`,
        status: r.status,
        checkInVerification: r.checkInVerification,
        checkInDistanceMeters: r.checkInDistanceMeters ? Number(r.checkInDistanceMeters) : null,
        hasCorrections: r.corrections.length > 0,
      };
    });

    if (query.format === 'csv') {
      const headers = [
        'Record ID',
        'Date',
        'Employee Code',
        'Employee Name',
        'Project Code',
        'Project Name',
        'Site Name',
        'Site Timezone',
        'Scheduled Start',
        'Scheduled End',
        'Check In (Local)',
        'Check Out (Local)',
        'Duration (Minutes)',
        'Duration (Hours)',
        'Status',
        'Verification',
        'Distance (Meters)',
        'Has Corrections',
      ];

      const csvRows = rows.map((row) =>
        [
          row.recordId,
          row.attendanceDate,
          row.employeeCode,
          row.employeeName,
          row.projectCode,
          row.projectName,
          row.siteName,
          row.siteTimezone,
          row.scheduledStart,
          row.scheduledEnd,
          row.checkInLocalTime ?? '',
          row.checkOutLocalTime ?? '',
          row.workDurationMinutes ?? '',
          row.workHoursFormatted,
          row.status,
          row.checkInVerification ?? '',
          row.checkInDistanceMeters ?? '',
          row.hasCorrections ? 'YES' : 'NO',
        ]
          .map(escapeCsvCell)
          .join(','),
      );

      const csvContent = [headers.map(escapeCsvCell).join(','), ...csvRows].join('\r\n');
      return { format: 'csv', data: csvContent };
    }

    return { format: 'json', data: rows };
  }
}
