import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdminAttendanceQuery,
  AttendanceActionResponse,
  AttendanceCheckInInput,
  AttendanceLocationInput,
  AttendanceVerificationStatus,
  WorkerTodayResponse,
} from '@workforce/contracts';
import type { WorkerPrincipal } from '../auth/principal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { haversineDistanceMeters, isLocationReliable } from './geofence.js';
import {
  calculateWorkDurationMinutes,
  evaluateCheckInStatus,
  evaluateCheckOutStatus,
  getSiteDate,
} from './schedule-evaluator.js';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private async storeCheckInPhoto(input: AttendanceCheckInInput, principal: WorkerPrincipal, idempotencyKey: string): Promise<string> {
    const baseUrl = this.configService.get<string>('SUPABASE_URL') ?? process.env.SUPABASE_URL;
    const serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) throw new BadRequestException('PHOTO_STORAGE_NOT_CONFIGURED');
    const [header, encoded] = input.proofPhotoDataUrl.split(',', 2);
    const mime = header.includes('webp') ? 'image/webp' : 'image/jpeg';
    const bytes = Buffer.from(encoded ?? '', 'base64');
    if (!bytes.length || bytes.length > 2_000_000) throw new BadRequestException('PROOF_PHOTO_TOO_LARGE');
    const extension = mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `${principal.organizationId}/${principal.employeeId}/${idempotencyKey}.${extension}`;
    const response = await fetch(`${baseUrl}/storage/v1/object/attendance-evidence/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': mime, 'x-upsert': 'false' },
      body: bytes,
    });
    if (!response.ok) throw new BadRequestException('PHOTO_UPLOAD_FAILED');
    return path;
  }

  /**
   * Resolves active dated assignment for the worker for today in the site's IANA timezone.
   */
  async getWorkerToday(principal: WorkerPrincipal): Promise<WorkerTodayResponse> {
    const now = new Date();

    const assignments = await this.prisma.assignment.findMany({
      where: {
        organizationId: principal.organizationId,
        employeeId: principal.employeeId,
        status: 'ACTIVE',
      },
      include: {
        site: true,
        schedule: true,
      },
    });

    if (assignments.length === 0) {
      throw new NotFoundException('NO_VALID_ASSIGNMENT');
    }

    // Filter assignments valid for the local calendar date at the site
    const validToday = assignments.filter((a) => {
      const siteDateStr = getSiteDate(now, a.site.timezone);
      const siteDate = new Date(`${siteDateStr}T00:00:00.000Z`);
      const startsOn = new Date(a.startsOn);
      const endsOn = a.endsOn ? new Date(a.endsOn) : null;

      const isStarted = siteDate >= startsOn;
      const isNotEnded = !endsOn || siteDate <= endsOn;
      return isStarted && isNotEnded;
    });

    if (validToday.length === 0) {
      throw new NotFoundException('NO_VALID_ASSIGNMENT');
    }

    if (validToday.length > 1) {
      throw new BadRequestException('AMBIGUOUS_ASSIGNMENT');
    }

    const assignment = validToday[0]!;
    const siteDateStr = getSiteDate(now, assignment.site.timezone);
    const siteDate = new Date(`${siteDateStr}T00:00:00.000Z`);

    const record = await this.prisma.attendanceRecord.findUnique({
      where: {
        assignmentId_attendanceDate: {
          assignmentId: assignment.id,
          attendanceDate: siteDate,
        },
      },
    });

    return {
      date: siteDateStr,
      siteTimezone: assignment.site.timezone,
      assignment: {
        id: assignment.id,
        startsOn: assignment.startsOn.toISOString().slice(0, 10),
        endsOn: assignment.endsOn ? assignment.endsOn.toISOString().slice(0, 10) : null,
      },
      site: {
        id: assignment.site.id,
        name: assignment.site.name,
        latitude: Number(assignment.site.latitude),
        longitude: Number(assignment.site.longitude),
        allowedRadiusMeters: assignment.site.allowedRadiusMeters,
        timezone: assignment.site.timezone,
      },
      schedule: {
        id: assignment.schedule.id,
        name: assignment.schedule.name,
        startTime: assignment.schedule.startTime,
        endTime: assignment.schedule.endTime,
        graceMinutes: assignment.schedule.graceMinutes,
      },
      attendance: record
        ? {
            id: record.id,
            status: record.status,
            checkInAt: record.checkInAt ? record.checkInAt.toISOString() : null,
            checkOutAt: record.checkOutAt ? record.checkOutAt.toISOString() : null,
            verification: record.checkInVerification,
            workDurationMinutes: record.workDurationMinutes,
          }
        : null,
    };
  }

  /**
   * Authoritative, idempotent GPS-backed worker check-in.
   */
  async checkIn(
    principal: WorkerPrincipal,
    input: AttendanceLocationInput & { proofPhotoDataUrl?: string },
    idempotencyKey: string,
  ): Promise<AttendanceActionResponse> {
    if (!idempotencyKey) {
      throw new BadRequestException('MISSING_IDEMPOTENCY_KEY');
    }

    // 1. Check idempotency request log
    const existingRequest = await this.prisma.attendanceRequest.findUnique({
      where: {
        organizationId_employeeId_action_idempotencyKey: {
          organizationId: principal.organizationId,
          employeeId: principal.employeeId,
          action: 'CHECK_IN',
          idempotencyKey,
        },
      },
    });

    if (existingRequest && existingRequest.attendanceRecordId) {
      const existingRecord = await this.prisma.attendanceRecord.findUnique({
        where: { id: existingRequest.attendanceRecordId },
      });
      if (existingRecord) {
        return {
          attendanceId: existingRecord.id,
          action: 'CHECK_IN',
          status: existingRecord.status,
          verificationResult: existingRecord.checkInVerification ?? 'VERIFIED',
          timestamp: (existingRecord.checkInAt ?? existingRecord.createdAt).toISOString(),
          distanceMeters: Number(existingRecord.checkInDistanceMeters ?? 0),
          workDurationMinutes: existingRecord.workDurationMinutes,
          message: 'Check-in confirmed (idempotent)',
        };
      }
    }

    const checkInPhotoPath = input.proofPhotoDataUrl
      ? await this.storeCheckInPhoto(input as AttendanceCheckInInput, principal, idempotencyKey)
      : null;

    // 2. Resolve single valid assignment for today
    const now = new Date();
    const assignments = await this.prisma.assignment.findMany({
      where: {
        organizationId: principal.organizationId,
        employeeId: principal.employeeId,
        status: 'ACTIVE',
      },
      include: {
        site: true,
        schedule: true,
      },
    });

    const validToday = assignments.filter((a) => {
      const siteDateStr = getSiteDate(now, a.site.timezone);
      const siteDate = new Date(`${siteDateStr}T00:00:00.000Z`);
      const startsOn = new Date(a.startsOn);
      const endsOn = a.endsOn ? new Date(a.endsOn) : null;
      return siteDate >= startsOn && (!endsOn || siteDate <= endsOn);
    });

    if (validToday.length === 0) throw new NotFoundException('NO_VALID_ASSIGNMENT');
    if (validToday.length > 1) throw new BadRequestException('AMBIGUOUS_ASSIGNMENT');

    const assignment = validToday[0]!;
    const siteDateStr = getSiteDate(now, assignment.site.timezone);
    const siteDate = new Date(`${siteDateStr}T00:00:00.000Z`);

    // 3. Ensure not already checked in for today
    const existingRecord = await this.prisma.attendanceRecord.findUnique({
      where: {
        assignmentId_attendanceDate: {
          assignmentId: assignment.id,
          attendanceDate: siteDate,
        },
      },
    });

    if (existingRecord && existingRecord.checkInAt) {
      throw new ConflictException('ALREADY_CHECKED_IN');
    }

    // 4. Compute authoritative server-side distance and reliability
    const siteCoords = {
      latitude: Number(assignment.site.latitude),
      longitude: Number(assignment.site.longitude),
    };
    const distance = haversineDistanceMeters(
      { latitude: input.latitude, longitude: input.longitude },
      siteCoords,
    );

    const maxAccuracy = Math.min(100, assignment.site.allowedRadiusMeters);
    const reliable = isLocationReliable(input.accuracyMeters, maxAccuracy);

    let verification: AttendanceVerificationStatus = 'VERIFIED';
    if (!reliable) {
      verification = 'LOW_ACCURACY';
    } else if (distance > assignment.site.allowedRadiusMeters) {
      verification = 'OUTSIDE_GEOFENCE';
    }

    const attendanceStatus = evaluateCheckInStatus({
      checkInAt: now,
      siteTimezone: assignment.site.timezone,
      startTime: assignment.schedule.startTime,
      graceMinutes: assignment.schedule.graceMinutes,
      verification,
    });

    // 5. Transactional record creation, event append, idempotency record, and audit log
    const record = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.attendanceRecord.upsert({
        where: {
          assignmentId_attendanceDate: {
            assignmentId: assignment.id,
            attendanceDate: siteDate,
          },
        },
        create: {
          organizationId: principal.organizationId,
          employeeId: principal.employeeId,
          assignmentId: assignment.id,
          attendanceDate: siteDate,
          checkInAt: now,
          checkInLatitude: input.latitude,
          checkInLongitude: input.longitude,
          checkInAccuracyMeters: input.accuracyMeters,
          checkInDistanceMeters: Math.round(distance * 100) / 100,
          checkInVerification: verification,
          checkInPhotoPath,
          status: attendanceStatus,
        },
        update: {
          checkInAt: now,
          checkInLatitude: input.latitude,
          checkInLongitude: input.longitude,
          checkInAccuracyMeters: input.accuracyMeters,
          checkInDistanceMeters: Math.round(distance * 100) / 100,
          checkInVerification: verification,
          checkInPhotoPath,
          status: attendanceStatus,
        },
      });

      let eventType: any = 'CHECK_IN_SUCCESS';
      if (verification === 'OUTSIDE_GEOFENCE') eventType = 'CHECK_IN_OUTSIDE_GEOFENCE';
      if (verification === 'LOW_ACCURACY') eventType = 'CHECK_IN_LOW_ACCURACY';

      await tx.attendanceEvent.create({
        data: {
          organizationId: principal.organizationId,
          attendanceRecordId: rec.id,
          type: eventType,
          occurredAt: now,
          metadata: {
            distanceMeters: Math.round(distance * 100) / 100,
            accuracyMeters: input.accuracyMeters,
            idempotencyKey,
          },
        },
      });

      await tx.attendanceRequest.create({
        data: {
          organizationId: principal.organizationId,
          employeeId: principal.employeeId,
          action: 'CHECK_IN',
          idempotencyKey,
          attendanceRecordId: rec.id,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: principal.organizationId,
          action: 'ATTENDANCE_CHECK_IN',
          targetType: 'AttendanceRecord',
          targetId: rec.id,
          metadata: {
            employeeId: principal.employeeId,
            status: attendanceStatus,
            verification,
          },
        },
      });

      return rec;
    });

    return {
      attendanceId: record.id,
      action: 'CHECK_IN',
      status: record.status,
      verificationResult: verification,
      timestamp: now.toISOString(),
      distanceMeters: Math.round(distance * 100) / 100,
      workDurationMinutes: null,
      message:
        verification === 'VERIFIED'
          ? 'Check-in confirmed'
          : verification === 'OUTSIDE_GEOFENCE'
          ? `Check-in warning: You are ${Math.round(distance)}m away from site (Allowed radius: ${assignment.site.allowedRadiusMeters}m). Marked as OUTSIDE_GEOFENCE.`
          : `Check-in recorded with exception: ${verification}`,
    };
  }

  /**
   * Authoritative, idempotent GPS-backed worker check-out.
   */
  async checkOut(
    principal: WorkerPrincipal,
    input: AttendanceLocationInput,
    idempotencyKey: string,
  ): Promise<AttendanceActionResponse> {
    if (!idempotencyKey) {
      throw new BadRequestException('MISSING_IDEMPOTENCY_KEY');
    }

    // 1. Check idempotency request log
    const existingRequest = await this.prisma.attendanceRequest.findUnique({
      where: {
        organizationId_employeeId_action_idempotencyKey: {
          organizationId: principal.organizationId,
          employeeId: principal.employeeId,
          action: 'CHECK_OUT',
          idempotencyKey,
        },
      },
    });

    if (existingRequest && existingRequest.attendanceRecordId) {
      const existingRecord = await this.prisma.attendanceRecord.findUnique({
        where: { id: existingRequest.attendanceRecordId },
      });
      if (existingRecord) {
        return {
          attendanceId: existingRecord.id,
          action: 'CHECK_OUT',
          status: existingRecord.status,
          verificationResult: existingRecord.checkOutVerification ?? 'VERIFIED',
          timestamp: (existingRecord.checkOutAt ?? existingRecord.updatedAt).toISOString(),
          distanceMeters: Number(existingRecord.checkOutDistanceMeters ?? 0),
          workDurationMinutes: existingRecord.workDurationMinutes,
          message: 'Check-out confirmed (idempotent)',
        };
      }
    }

    // 2. Find open attendance record
    const openRecord = await this.prisma.attendanceRecord.findFirst({
      where: {
        organizationId: principal.organizationId,
        employeeId: principal.employeeId,
        checkInAt: { not: null },
        checkOutAt: null,
      },
      include: {
        assignment: {
          include: {
            site: true,
            schedule: true,
          },
        },
      },
      orderBy: { checkInAt: 'desc' },
    });

    if (!openRecord || !openRecord.checkInAt) {
      throw new BadRequestException('NO_OPEN_ATTENDANCE');
    }

    const now = new Date();
    const siteCoords = {
      latitude: Number(openRecord.assignment.site.latitude),
      longitude: Number(openRecord.assignment.site.longitude),
    };
    const distance = haversineDistanceMeters(
      { latitude: input.latitude, longitude: input.longitude },
      siteCoords,
    );

    const maxAccuracy = Math.min(100, openRecord.assignment.site.allowedRadiusMeters);
    const reliable = isLocationReliable(input.accuracyMeters, maxAccuracy);

    let verification: AttendanceVerificationStatus = 'VERIFIED';
    if (!reliable) {
      verification = 'LOW_ACCURACY';
    } else if (distance > openRecord.assignment.site.allowedRadiusMeters) {
      verification = 'OUTSIDE_GEOFENCE';
    }

    const durationMinutes = calculateWorkDurationMinutes(openRecord.checkInAt, now);
    const checkoutStatus = evaluateCheckOutStatus({
      checkOutAt: now,
      siteTimezone: openRecord.assignment.site.timezone,
      endTime: openRecord.assignment.schedule.endTime,
      verification,
    });

    // 3. Transactional update
    const record = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.attendanceRecord.update({
        where: { id: openRecord.id },
        data: {
          checkOutAt: now,
          checkOutLatitude: input.latitude,
          checkOutLongitude: input.longitude,
          checkOutAccuracyMeters: input.accuracyMeters,
          checkOutDistanceMeters: Math.round(distance * 100) / 100,
          checkOutVerification: verification,
          status: checkoutStatus,
          workDurationMinutes: durationMinutes,
        },
      });

      await tx.attendanceEvent.create({
        data: {
          organizationId: principal.organizationId,
          attendanceRecordId: rec.id,
          type: 'CHECK_OUT_SUCCESS',
          occurredAt: now,
          metadata: {
            distanceMeters: Math.round(distance * 100) / 100,
            accuracyMeters: input.accuracyMeters,
            workDurationMinutes: durationMinutes,
            idempotencyKey,
          },
        },
      });

      await tx.attendanceRequest.create({
        data: {
          organizationId: principal.organizationId,
          employeeId: principal.employeeId,
          action: 'CHECK_OUT',
          idempotencyKey,
          attendanceRecordId: rec.id,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: principal.organizationId,
          action: 'ATTENDANCE_CHECK_OUT',
          targetType: 'AttendanceRecord',
          targetId: rec.id,
          metadata: {
            employeeId: principal.employeeId,
            status: checkoutStatus,
            workDurationMinutes: durationMinutes,
          },
        },
      });

      return rec;
    });

    return {
      attendanceId: record.id,
      action: 'CHECK_OUT',
      status: record.status,
      verificationResult: verification,
      timestamp: now.toISOString(),
      distanceMeters: Math.round(distance * 100) / 100,
      workDurationMinutes: durationMinutes,
      message:
        verification === 'VERIFIED'
          ? 'Check-out confirmed'
          : `Check-out recorded with exception: ${verification}`,
    };
  }

  /**
   * Scoped attendance list for admin portal.
   */
  async getTodayAttendanceForAdmin(organizationId: string, query: AdminAttendanceQuery) {
    // This endpoint must always be date-bounded. The client should provide the
    // displayed site date; the server fallback preserves the existing contract.
    const attendanceDate = query.date
      ? new Date(`${query.date}T00:00:00.000Z`)
      : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const where: any = { organizationId, attendanceDate };

    if (query.siteId) {
      where.assignment = { siteId: query.siteId };
    }
    if (query.projectId) {
      where.assignment = { ...where.assignment, site: { projectId: query.projectId } };
    }
    const records = await this.prisma.attendanceRecord.findMany({
      where,
      select: {
        id: true,
        attendanceDate: true,
        checkInAt: true,
        checkOutAt: true,
        status: true,
        checkInVerification: true,
        checkOutVerification: true,
        workDurationMinutes: true,
        employee: {
          select: { id: true, employeeCode: true, fullName: true },
        },
        assignment: {
          select: {
            site: { select: { id: true, name: true } },
            schedule: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((r) => ({
      id: r.id,
      employee: {
        id: r.employee.id,
        employeeCode: r.employee.employeeCode,
        fullName: r.employee.fullName,
      },
      site: {
        id: r.assignment.site.id,
        name: r.assignment.site.name,
      },
      schedule: {
        id: r.assignment.schedule.id,
        name: r.assignment.schedule.name,
      },
      attendanceDate: r.attendanceDate.toISOString().slice(0, 10),
      checkInAt: r.checkInAt ? r.checkInAt.toISOString() : null,
      checkOutAt: r.checkOutAt ? r.checkOutAt.toISOString() : null,
      status: r.status,
      checkInVerification: r.checkInVerification,
      checkOutVerification: r.checkOutVerification,
      workDurationMinutes: r.workDurationMinutes,
    }));
  }

  /**
   * Scoped detailed attendance record with full event timeline for admin portal.
   */
  async getAttendanceDetailForAdmin(organizationId: string, id: string) {
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id, organizationId },
      include: {
        employee: true,
        assignment: {
          include: {
            site: true,
            schedule: true,
          },
        },
        events: {
          orderBy: { occurredAt: 'asc' },
        },
      },
    });

    if (!record) {
      throw new NotFoundException('ATTENDANCE_RECORD_NOT_FOUND');
    }

    return {
      id: record.id,
      employee: {
        id: record.employee.id,
        employeeCode: record.employee.employeeCode,
        fullName: record.employee.fullName,
      },
      site: {
        id: record.assignment.site.id,
        name: record.assignment.site.name,
        latitude: Number(record.assignment.site.latitude),
        longitude: Number(record.assignment.site.longitude),
        allowedRadiusMeters: record.assignment.site.allowedRadiusMeters,
        timezone: record.assignment.site.timezone,
      },
      schedule: {
        id: record.assignment.schedule.id,
        name: record.assignment.schedule.name,
        startTime: record.assignment.schedule.startTime,
        endTime: record.assignment.schedule.endTime,
      },
      attendanceDate: record.attendanceDate.toISOString().slice(0, 10),
      checkInAt: record.checkInAt ? record.checkInAt.toISOString() : null,
      checkOutAt: record.checkOutAt ? record.checkOutAt.toISOString() : null,
      checkInDistanceMeters: record.checkInDistanceMeters ? Number(record.checkInDistanceMeters) : null,
      checkInAccuracyMeters: record.checkInAccuracyMeters ? Number(record.checkInAccuracyMeters) : null,
      checkInVerification: record.checkInVerification,
      checkOutDistanceMeters: record.checkOutDistanceMeters ? Number(record.checkOutDistanceMeters) : null,
      checkOutAccuracyMeters: record.checkOutAccuracyMeters ? Number(record.checkOutAccuracyMeters) : null,
      checkOutVerification: record.checkOutVerification,
      status: record.status,
      workDurationMinutes: record.workDurationMinutes,
      events: record.events.map((e) => ({
        id: e.id,
        type: e.type,
        occurredAt: e.occurredAt.toISOString(),
        metadata: e.metadata,
      })),
    };
  }
}
