import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdminAttendanceQuery,
  AttendanceActionResponse,
  AttendanceCheckInInput,
  AttendanceLocationInput,
  AttendanceVerificationStatus,
  RecordVisitInput,
  WorkerTodayResponse,
} from '@workforce/contracts';
import type { WorkerPrincipal } from '../auth/principal.js';
import { ProjectAuthorizationService, type ProjectAccessSource } from '../auth/project-authorization.service.js';
import type { AdminDataScope } from '../auth/admin-scope.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramOutboxService } from '../jobs/telegram-outbox.service.js';
import { TelegramNotifierService } from '../jobs/telegram-notifier.service.js';
import { SalesService } from '../sales/sales.service.js';
import { km } from '@workforce/contracts';
import { haversineDistanceMeters, isLocationReliable } from './geofence.js';
import { readAttendanceReplay, readConnectedProjects, readOpenAttendance, readWorkerAssignments, type AttendanceReplay } from './worker-read-model.js';
import { writeAttendance, type AttendanceDeliveryIntent, type AttendanceWriteInput, type AttendanceWriteResult } from './attendance-write-model.js';
import { encodeSalesReportFollowup } from '../sales/report-followup.js';
import { CacheService } from '../common/cache/cache.service.js';
import { timeStep } from '../common/performance/request-timing.js';
import {
  calculateWorkDurationMinutes,
  evaluateCheckInStatus,
  evaluateCheckOutStatus,
  getSiteDate,
} from './schedule-evaluator.js';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly telegramOutbox: TelegramOutboxService,
    private readonly projectAuthorization: ProjectAuthorizationService,
    private readonly telegramNotifier: TelegramNotifierService,
    private readonly salesService: SalesService,
    @Optional() private readonly cache?: CacheService,
  ) { }

  private async resolveCurrentProject(principal: WorkerPrincipal, revalidateFor?: ProjectAccessSource) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: principal.employeeId, organizationId: principal.organizationId, status: 'ACTIVE' },
      include: { currentProject: true },
    });
    if (!employee?.currentProject || employee.currentProject.status !== 'ACTIVE') {
      throw new NotFoundException('NO_CURRENT_PROJECT');
    }
    const connection = await this.prisma.workerProject.findUnique({
      where: { employeeId_projectId: { employeeId: principal.employeeId, projectId: employee.currentProjectId! } },
    });
    if (!connection) throw new NotFoundException('NO_CURRENT_PROJECT');
    if (revalidateFor && this.projectAuthorization?.authorizeWorkerProject) {
      await this.projectAuthorization.authorizeWorkerProject(
        principal,
        employee.currentProject.id,
        revalidateFor,
        true,
      );
    }
    const projectWithMeta = employee.currentProject as typeof employee.currentProject & { employeeFullName?: string };
    projectWithMeta.employeeFullName = employee.fullName;
    return projectWithMeta;
  }

  private async resolveWorkerAssignments(principal: WorkerPrincipal, currentProjectId?: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: {
        organizationId: principal.organizationId,
        employeeId: principal.employeeId,
        status: 'ACTIVE',
        site: { status: 'ACTIVE', project: { status: 'ACTIVE' } },
      },
      include: { site: true, schedule: true },
    });
    if (!currentProjectId) return assignments;
    const directAssignments = assignments.filter((assignment) => assignment.site.projectId === currentProjectId);
    if (directAssignments.length > 0) return directAssignments;
    return assignments;
  }

  async listConnectedProjects(principal: WorkerPrincipal) {
    const load = () => timeStep('worker', () => readConnectedProjects(this.prisma, principal));
    return this.cache
      ? this.cache.getOrLoad({ prefix: this.workerReadKey(principal), key: 'projects' }, 15_000, load)
      : load();
  }

  private workerReadKey(principal: WorkerPrincipal) {
    return `worker-read:${principal.organizationId}:${principal.employeeId}`;
  }

  private async invalidateWorkerReads(principal: WorkerPrincipal) {
    await this.cache?.invalidatePrefix(this.workerReadKey(principal));
  }

  async setCurrentProject(principal: WorkerPrincipal, projectId: string) {
    const authorization = this.projectAuthorization?.authorizeWorkerProject
      ? await this.projectAuthorization.authorizeWorkerProject(principal, projectId, 'MINI_APP_SWITCH', true)
      : null;
    const connection = authorization?.connection ?? (
      typeof (this.prisma.workerProject as any).findFirst === 'function'
        ? await (this.prisma.workerProject as any).findFirst({
          where: { employeeId: principal.employeeId, projectId },
          include: { project: true },
        })
        : await this.prisma.workerProject.findUnique({
          where: { employeeId_projectId: { employeeId: principal.employeeId, projectId } },
          include: { project: true },
        })
    );
    if (!connection) throw new NotFoundException('PROJECT_NOT_CONNECTED');
    const project = authorization?.project ?? (connection as any).project ?? await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('PROJECT_NOT_FOUND');

    await this.prisma.$transaction(async (tx) => {
      await tx.workerProject.update({ where: { id: connection.id }, data: { lastSelectedAt: new Date() } });
      await tx.employee.update({ where: { id: principal.employeeId }, data: { currentProjectId: projectId } });
      await tx.auditLog.create({ data: { organizationId: principal.organizationId, action: 'WORKER_CURRENT_PROJECT_SET', targetType: 'Project', targetId: projectId, metadata: { employeeId: principal.employeeId, source: 'MINI_APP' } } });
    });
    if (this.projectAuthorization?.ensureProjectSiteAndAssignment) {
      await this.projectAuthorization.ensureProjectSiteAndAssignment(
        principal.organizationId,
        projectId,
        principal.employeeId,
      );
    }
    await this.invalidateWorkerReads(principal);
    return { id: project.id, name: project.name };
  }

  private async storeCheckInPhoto(input: AttendanceCheckInInput, principal: WorkerPrincipal, idempotencyKey: string): Promise<string> {
    const baseUrl = this.configService.get<string>('SUPABASE_URL') ?? process.env.SUPABASE_URL;
    const serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) throw new BadRequestException('PHOTO_STORAGE_NOT_CONFIGURED');
    const [header, encoded] = input.proofPhotoDataUrl.split(',', 2);
    const mime = header.includes('webp') ? 'image/webp' : 'image/jpeg';
    const bytes = Buffer.from(encoded ?? '', 'base64');
    if (!bytes.length || bytes.length > 3_000_000) throw new BadRequestException('PROOF_PHOTO_TOO_LARGE');
    const extension = mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `${principal.organizationId}/${principal.employeeId}/${idempotencyKey}.${extension}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${baseUrl}/storage/v1/object/attendance-evidence/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': mime, 'x-upsert': 'true' },
        body: bytes,
        signal: controller.signal,
      });
      if (!response.ok) throw new BadRequestException('PHOTO_UPLOAD_FAILED');
      return path;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new BadRequestException('PHOTO_UPLOAD_TIMEOUT');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async createEvidenceSignedUrl(storagePath: string | null): Promise<string | null> {
    if (!storagePath) return null;
    const baseUrl = this.configService.get<string>('SUPABASE_URL') ?? process.env.SUPABASE_URL;
    const serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) return null;
    const response = await fetch(`${baseUrl}/storage/v1/object/sign/attendance-evidence/${storagePath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 300 }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { signedURL?: string; signedUrl?: string };
    const signedPath = payload.signedURL ?? payload.signedUrl;
    if (!signedPath) return null;
    return signedPath.startsWith('http') ? signedPath : `${baseUrl}/storage/v1${signedPath}`;
  }

  /**
   * Resolves active dated assignment for the worker for today in the site's IANA timezone.
   */
  async getWorkerToday(principal: WorkerPrincipal): Promise<WorkerTodayResponse> {
    const load = () => this.loadWorkerToday(principal);
    const result = this.cache
      ? await this.cache.getOrLoad({ prefix: this.workerReadKey(principal), key: 'today' }, 2_000, load)
      : await load();
    // Never show yesterday's state across a site's midnight, even within the tiny display cache TTL.
    if (result.date !== getSiteDate(new Date(), result.siteTimezone)) return load();
    return result;
  }

  private async loadWorkerToday(principal: WorkerPrincipal): Promise<WorkerTodayResponse> {
    const now = new Date();
    const rows = await timeStep('assignment', () => readWorkerAssignments(this.prisma, principal));
    const currentProject = rows[0]?.currentProject;
    if (!currentProject) throw new NotFoundException('NO_CURRENT_PROJECT');
    const candidates = rows.flatMap((row) => row.id && row.startsOn && row.site && row.schedule
      ? [{ id: row.id, startsOn: row.startsOn, endsOn: row.endsOn, site: row.site, schedule: row.schedule, attendance: row.attendance }]
      : []);
    // Preserve the existing legacy assignment fallback and ambiguity checks.
    const direct = candidates.filter((assignment) => assignment.site.projectId === currentProject.id);
    const assignments = direct.length ? direct : candidates;

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

    const assignmentRow = validToday[0]!;
    const assignment = assignmentRow;
    const siteDateStr = getSiteDate(now, assignment.site.timezone);
    const siteDate = new Date(`${siteDateStr}T00:00:00.000Z`);

    let record: any = (assignmentRow as any).attendance;
    if (record === undefined && typeof this.prisma.attendanceRecord?.findFirst === 'function') {
      record = await this.prisma.attendanceRecord.findFirst({
        where: {
          organizationId: principal.organizationId,
          employeeId: principal.employeeId,
          assignmentId: assignment.id,
          attendanceDate: siteDate,
        },
        select: { id: true, status: true, checkInAt: true, checkOutAt: true, checkInVerification: true, workDurationMinutes: true },
      });
    }

    return {
      date: siteDateStr,
      siteTimezone: assignment.site.timezone,
      currentProject: { id: currentProject.id, name: currentProject.name, workMode: currentProject.workMode as 'SITE' | 'SALES' },
      assignment: {
        id: assignment.id,
        startsOn: new Date(assignment.startsOn).toISOString().slice(0, 10),
        endsOn: assignment.endsOn ? new Date(assignment.endsOn).toISOString().slice(0, 10) : null,
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
          checkInAt: record.checkInAt ? new Date(record.checkInAt).toISOString() : null,
          checkOutAt: record.checkOutAt ? new Date(record.checkOutAt).toISOString() : null,
          verification: record.verification ?? record.checkInVerification ?? null,
          workDurationMinutes: record.workDurationMinutes,
        }
        : null,
    };
  }

  /** Authoritative check-in: read once, verify membership, persist proof, commit once. */
  async checkIn(
    principal: WorkerPrincipal,
    input: AttendanceLocationInput & { proofPhotoDataUrl?: string },
    idempotencyKey: string,
  ): Promise<AttendanceActionResponse> {
    if (!idempotencyKey) throw new BadRequestException('MISSING_IDEMPOTENCY_KEY');
    const now = new Date();
    const [replay, rows] = await Promise.all([
      timeStep('idempotency', () => readAttendanceReplay(this.prisma, principal, 'CHECK_IN', idempotencyKey)),
      timeStep('assignment', () => readWorkerAssignments(this.prisma, principal)),
    ]);
    if (replay) return this.replayResponse(replay, 'CHECK_IN');
    if (!input.proofPhotoDataUrl) throw new BadRequestException('PROOF_PHOTO_REQUIRED');

    const first = rows[0];
    if (!first?.currentProject) throw new NotFoundException('NO_CURRENT_PROJECT');
    const currentProject = first.currentProject;
    const candidates = rows.flatMap((row) => row.id && row.startsOn && row.site && row.schedule
      ? [{ ...row, id: row.id, startsOn: row.startsOn, site: row.site, schedule: row.schedule }]
      : []);
    const direct = candidates.filter((row) => row.site.projectId === currentProject.id);
    const validToday = (direct.length ? direct : candidates).filter((row) => {
      const date = new Date(`${getSiteDate(now, row.site.timezone)}T00:00:00.000Z`);
      return date >= new Date(row.startsOn) && (!row.endsOn || date <= new Date(row.endsOn));
    });
    if (!validToday.length) throw new NotFoundException('NO_VALID_ASSIGNMENT');
    if (validToday.length > 1) throw new BadRequestException('AMBIGUOUS_ASSIGNMENT');
    const assignment = validToday[0]!;
    if (assignment.attendance?.checkInAt) throw new ConflictException('ALREADY_CHECKED_IN');

    await timeStep('membership', () => this.projectAuthorization.authorizeWorkerProject(
      principal, currentProject.id, 'CHECK_IN', true, {
        project: {
          id: currentProject.id, organizationId: currentProject.organizationId!,
          name: currentProject.name, status: currentProject.status!,
          telegramChatId: currentProject.telegramChatId ?? null, workMode: currentProject.workMode,
        },
        connection: first.connection ?? null,
      },
    ));

    const distance = haversineDistanceMeters(
      { latitude: input.latitude, longitude: input.longitude },
      { latitude: Number(assignment.site.latitude), longitude: Number(assignment.site.longitude) },
    );
    const verification: AttendanceVerificationStatus = !isLocationReliable(input.accuracyMeters, Math.min(100, assignment.site.allowedRadiusMeters))
      ? 'LOW_ACCURACY' : distance > assignment.site.allowedRadiusMeters ? 'OUTSIDE_GEOFENCE' : 'VERIFIED';
    const status = evaluateCheckInStatus({
      checkInAt: now, siteTimezone: assignment.site.timezone,
      startTime: assignment.schedule.startTime, graceMinutes: assignment.schedule.graceMinutes, verification,
    });
    // Proof must be durable before a successful attendance response. Only rendering
    // is client-side; deferring the sole copy of the photo would risk losing evidence.
    const photoPath = await timeStep('storage_upload', () => this.storeCheckInPhoto(input as AttendanceCheckInInput, principal, idempotencyKey));
    const caption = currentProject.telegramChatId && currentProject.employeeFullName
      ? km.telegram.checkInCaption(currentProject.employeeFullName, currentProject.name,
        new Intl.DateTimeFormat('en-GB', { timeZone: assignment.site.timezone, hour: '2-digit', minute: '2-digit', hour12: true }).format(now),
        { isOutside: verification === 'OUTSIDE_GEOFENCE', isLate: status === 'LATE', distanceMeters: distance, accuracyMeters: input.accuracyMeters })
      : null;

    const saved = await this.commitAttendance(principal, {
      action: 'CHECK_IN', organizationId: principal.organizationId, employeeId: principal.employeeId,
      projectId: currentProject.id, assignmentId: assignment.id, siteId: assignment.site.id,
      attendanceDate: new Date(`${getSiteDate(now, assignment.site.timezone)}T00:00:00.000Z`),
      existingRecordId: assignment.attendance?.id ?? null, telegramChatId: currentProject.telegramChatId ?? null,
      checkInPhotoPath: photoPath, idempotencyKey, now, location: input, distance, verification, status,
      deliveries: caption && currentProject.telegramChatId ? [{
        kind: 'PHOTO', chatId: currentProject.telegramChatId, text: caption, storagePath: photoPath,
      }] : [],
    });
    if ('action' in saved) return saved;
    return {
      attendanceId: saved.record.id, action: 'CHECK_IN', status: saved.record.status,
      verificationResult: verification, timestamp: now.toISOString(),
      distanceMeters: Math.round(distance * 100) / 100, workDurationMinutes: null,
      message: verification === 'VERIFIED' ? 'Check-in confirmed'
        : verification === 'OUTSIDE_GEOFENCE'
          ? `Check-in warning: You are ${Math.round(distance)}m away from site (Allowed radius: ${assignment.site.allowedRadiusMeters}m). Marked as OUTSIDE_GEOFENCE.`
          : `Check-in recorded with exception: ${verification}`,
    };
  }

  private replayResponse(record: AttendanceReplay, action: 'CHECK_IN' | 'CHECK_OUT'): AttendanceActionResponse {
    return {
      attendanceId: record.id, action, status: record.status,
      verificationResult: record.verification ?? 'VERIFIED', timestamp: new Date(record.timestamp).toISOString(),
      distanceMeters: Number(record.distanceMeters), workDurationMinutes: record.workDurationMinutes,
      message: `${action === 'CHECK_IN' ? 'Check-in' : 'Check-out'} confirmed (idempotent)`,
    };
  }

  private async commitAttendance(principal: WorkerPrincipal, input: AttendanceWriteInput): Promise<AttendanceWriteResult | AttendanceActionResponse> {
    let saved: AttendanceWriteResult | null;
    try {
      saved = await timeStep('transaction', () => writeAttendance(this.prisma, input));
    } catch (error) {
      const duplicate = typeof error === 'object' && error !== null &&
        ('code' in error && error.code === 'P2002' ||
          'meta' in error && (error.meta as { code?: string } | undefined)?.code === '23505');
      if (!duplicate) throw error;
      saved = null;
    }
    if (!saved) {
      const replay = await readAttendanceReplay(this.prisma, principal, input.action, input.idempotencyKey);
      if (replay) return this.replayResponse(replay, input.action);
      throw new ConflictException(input.action === 'CHECK_IN' ? 'ALREADY_CHECKED_IN' : 'ALREADY_CHECKED_OUT');
    }
    // Cache outage or job enqueue must never turn a committed attendance into a failed submission.
    try { await this.invalidateWorkerReads(principal); } catch { /* TTL bounds stale display data. */ }
    for (const id of saved.deliveryIds) this.telegramOutbox.dispatch(id, principal.organizationId);
    return saved;
  }

  async recordVisit(principal: WorkerPrincipal, input: RecordVisitInput, idempotencyKey: string) {
    const existing = await this.prisma.visitLog.findUnique({
      where: {
        organizationId_employeeId_idempotencyKey: {
          organizationId: principal.organizationId,
          employeeId: principal.employeeId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      return {
        visitId: existing.id,
        verificationResult: existing.verification,
        timestamp: existing.visitedAt.toISOString(),
        distanceMeters: Number(existing.distanceMeters),
        message: 'Visit recorded (idempotent)',
      };
    }
    const currentProject = await this.resolveCurrentProject(principal, 'VISIT');
    if (currentProject.workMode !== 'SALES') throw new BadRequestException('VISITS_REQUIRE_SALES_PROJECT');

    const openAttendance = await this.prisma.attendanceRecord.findFirst({
      where: { organizationId: principal.organizationId, employeeId: principal.employeeId, projectId: currentProject.id, checkOutAt: null },
      select: { id: true },
    });
    if (!openAttendance) throw new BadRequestException('CHECK_IN_REQUIRED_FOR_VISIT');

    const assignments = await this.resolveWorkerAssignments(principal, currentProject.id);
    if (!assignments || assignments.length !== 1) throw new BadRequestException(assignments?.length ? 'AMBIGUOUS_ASSIGNMENT' : 'NO_VALID_ASSIGNMENT');
    const assignment = assignments[0]!;
    if (input.outletId) {
      const outlet = await this.prisma.outlet.findFirst({
        where: { id: input.outletId, organizationId: principal.organizationId, projectId: currentProject.id, status: 'ACTIVE' },
      });
      if (!outlet) throw new BadRequestException('OUTLET_NOT_AVAILABLE');
    }
    const distance = haversineDistanceMeters({ latitude: input.latitude, longitude: input.longitude }, { latitude: Number(assignment.site.latitude), longitude: Number(assignment.site.longitude) });
    const verification: AttendanceVerificationStatus = !isLocationReliable(input.accuracyMeters, Math.min(100, assignment.site.allowedRadiusMeters)) ? 'LOW_ACCURACY' : distance > assignment.site.allowedRadiusMeters ? 'OUTSIDE_GEOFENCE' : 'VERIFIED';
    const proofPhotoPath = await this.storeCheckInPhoto(input, principal, `visit-${idempotencyKey}`);
    const visit = await this.prisma.visitLog.create({ data: { organizationId: principal.organizationId, employeeId: principal.employeeId, assignmentId: assignment.id, siteId: assignment.siteId, projectId: currentProject.id, attendanceRecordId: openAttendance.id, outletId: input.outletId ?? null, latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters, distanceMeters: Math.round(distance * 100) / 100, verification, proofPhotoPath, customerName: input.customerName ?? null, note: input.note ?? null, visitResult: input.visitResult ?? null, followUpRequired: input.followUpRequired ?? false, followUpAt: input.followUpAt ? new Date(input.followUpAt) : null, potentialOrderQuantity: input.potentialOrderQuantity ?? null, requestedDiscountPerItem: input.requestedDiscountPerItem ?? null, idempotencyKey } });
    await this.prisma.auditLog.create({ data: { organizationId: principal.organizationId, action: 'VISIT_RECORDED', targetType: 'VisitLog', targetId: visit.id, metadata: { verification, hasCustomerName: Boolean(input.customerName), hasNote: Boolean(input.note) } } });
    return { visitId: visit.id, verificationResult: verification, timestamp: visit.visitedAt.toISOString(), distanceMeters: Number(visit.distanceMeters), message: 'Visit recorded' };
  }

  /**
   * Authoritative, idempotent GPS-backed worker check-out.
   */
  async checkOut(
    principal: WorkerPrincipal,
    input: AttendanceLocationInput,
    idempotencyKey: string,
  ): Promise<AttendanceActionResponse> {
    if (!idempotencyKey) throw new BadRequestException('MISSING_IDEMPOTENCY_KEY');
    const [replay, openRecord] = await Promise.all([
      timeStep('idempotency', () => readAttendanceReplay(this.prisma, principal, 'CHECK_OUT', idempotencyKey)),
      timeStep('assignment', () => readOpenAttendance(this.prisma, principal)),
    ]);
    if (replay) return this.replayResponse(replay, 'CHECK_OUT');
    if (!openRecord) throw new BadRequestException('NO_OPEN_ATTENDANCE');
    await timeStep('membership', () => this.projectAuthorization.authorizeWorkerProject(
      principal, openRecord.projectId, 'CHECK_OUT', true,
      { project: openRecord.project, connection: openRecord.connection },
    ));

    const now = new Date();
    const distance = haversineDistanceMeters(
      { latitude: input.latitude, longitude: input.longitude },
      { latitude: Number(openRecord.assignment.site.latitude), longitude: Number(openRecord.assignment.site.longitude) },
    );
    const verification: AttendanceVerificationStatus =
      !isLocationReliable(input.accuracyMeters, Math.min(100, openRecord.assignment.site.allowedRadiusMeters))
        ? 'LOW_ACCURACY' : distance > openRecord.assignment.site.allowedRadiusMeters ? 'OUTSIDE_GEOFENCE' : 'VERIFIED';
    const durationMinutes = calculateWorkDurationMinutes(new Date(openRecord.checkInAt), now);
    const status = evaluateCheckOutStatus({
      checkOutAt: now, siteTimezone: openRecord.assignment.site.timezone,
      endTime: openRecord.assignment.schedule.endTime, verification,
    });
    const deliveries: AttendanceDeliveryIntent[] = [];
    if (openRecord.telegramChatId) {
      const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: openRecord.assignment.site.timezone, hour: '2-digit', minute: '2-digit', hour12: true });
      deliveries.push({
        kind: 'TEXT', chatId: openRecord.telegramChatId,
        text: km.telegram.checkOutCaption(openRecord.employeeFullName, openRecord.project.name,
          timeFormat.format(new Date(openRecord.checkInAt)), timeFormat.format(now),
          `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`,
          { isOutside: verification === 'OUTSIDE_GEOFENCE' }),
      });
    }
    if (openRecord.project.workMode === 'SALES') {
      deliveries.push({
        kind: 'SALES_REPORT', chatId: principal.telegramUserId,
        text: encodeSalesReportFollowup({ employeeId: principal.employeeId, telegramUserId: principal.telegramUserId }),
      });
    }
    const saved = await this.commitAttendance(principal, {
      action: 'CHECK_OUT', organizationId: principal.organizationId, employeeId: principal.employeeId,
      projectId: openRecord.projectId, recordId: openRecord.id, idempotencyKey, now,
      location: input, distance, verification, status, workDurationMinutes: durationMinutes, deliveries,
    });
    if ('action' in saved) return saved;
    return {
      attendanceId: saved.record.id, action: 'CHECK_OUT', status: saved.record.status,
      verificationResult: verification, timestamp: now.toISOString(), distanceMeters: Math.round(distance * 100) / 100,
      workDurationMinutes: durationMinutes,
      message: verification === 'VERIFIED' ? 'Check-out confirmed' : `Check-out recorded with exception: ${verification}`,
    };
  }

  /**
   * Scoped attendance list for admin portal.
   */
  async getTodayAttendanceForAdmin(organizationId: string, query: AdminAttendanceQuery, scope?: AdminDataScope) {
    // This endpoint must always be date-bounded. The client should provide the
    // displayed site date; the server fallback preserves the existing contract.
    const attendanceDate = query.date
      ? new Date(`${query.date}T00:00:00.000Z`)
      : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const where: any = { organizationId, attendanceDate };

    if (query.siteId) {
      where.siteId = query.siteId;
    }
    if (query.projectId) {
      where.OR = [{ projectId: query.projectId }, { adjustedProjectId: query.projectId }];
    } else if (scope && !scope.unrestricted) {
      where.OR = [
        { projectId: { in: scope.projectIds } },
        { adjustedProjectId: { in: scope.projectIds } },
        { siteId: { in: scope.siteIds } },
      ];
    }
    const records = await this.prisma.attendanceRecord.findMany({
      where,
      select: {
        id: true,
        attendanceDate: true,
        checkInAt: true,
        checkOutAt: true,
        status: true,
        adjustedCheckInAt: true,
        adjustedCheckOutAt: true,
        adjustedStatus: true,
        checkInVerification: true,
        checkOutVerification: true,
        workDurationMinutes: true,
        site: { select: { id: true, name: true, projectId: true, timezone: true, allowedRadiusMeters: true } },
        project: { select: { id: true, code: true, name: true, workMode: true } },
        adjustedProject: { select: { id: true, code: true, name: true, workMode: true } },
        employee: {
          select: { id: true, employeeCode: true, fullName: true },
        },
        assignment: {
          select: {
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
        id: r.site.id,
        name: r.site.name,
        projectId: r.site.projectId,
        timezone: r.site.timezone,
        allowedRadiusMeters: r.site.allowedRadiusMeters,
      },
      schedule: {
        id: r.assignment.schedule.id,
        name: r.assignment.schedule.name,
      },
      project: r.adjustedProject ?? r.project,
      attendanceDate: r.attendanceDate.toISOString().slice(0, 10),
      checkInAt: (r.adjustedCheckInAt ?? r.checkInAt)?.toISOString() ?? null,
      checkOutAt: (r.adjustedCheckOutAt ?? r.checkOutAt)?.toISOString() ?? null,
      status: r.adjustedStatus ?? r.status,
      checkInVerification: r.checkInVerification,
      checkOutVerification: r.checkOutVerification,
      workDurationMinutes: r.workDurationMinutes,
    }));
  }

  /**
   * Scoped detailed attendance record with full event timeline for admin portal.
   */
  async getAttendanceDetailForAdmin(organizationId: string, id: string, scope?: AdminDataScope) {
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id, organizationId, ...(!scope || scope.unrestricted ? {} : { OR: [{ projectId: { in: scope.projectIds } }, { adjustedProjectId: { in: scope.projectIds } }, { siteId: { in: scope.siteIds } }] }) },
      include: {
        employee: true,
        site: true,
        assignment: {
          include: {
            site: true,
            schedule: true,
          },
        },
        events: {
          orderBy: { occurredAt: 'asc' },
        },
        project: true,
        adjustedProject: true,
      },
    });

    if (!record) {
      throw new NotFoundException('ATTENDANCE_RECORD_NOT_FOUND');
    }

    const proofPhotoUrl = await this.createEvidenceSignedUrl(record.checkInPhotoPath);

    return {
      id: record.id,
      employee: {
        id: record.employee.id,
        employeeCode: record.employee.employeeCode,
        fullName: record.employee.fullName,
      },
      site: {
        id: record.site.id,
        name: record.site.name,
        latitude: Number(record.site.latitude),
        longitude: Number(record.site.longitude),
        allowedRadiusMeters: record.site.allowedRadiusMeters,
        timezone: record.site.timezone,
      },
      schedule: {
        id: record.assignment.schedule.id,
        name: record.assignment.schedule.name,
        startTime: record.assignment.schedule.startTime,
        endTime: record.assignment.schedule.endTime,
      },
      project: {
        id: (record.adjustedProject ?? record.project).id,
        code: (record.adjustedProject ?? record.project).code,
        name: (record.adjustedProject ?? record.project).name,
        workMode: (record.adjustedProject ?? record.project).workMode,
      },
      attendanceDate: record.attendanceDate.toISOString().slice(0, 10),
      checkInAt: (record.adjustedCheckInAt ?? record.checkInAt)?.toISOString() ?? null,
      checkOutAt: (record.adjustedCheckOutAt ?? record.checkOutAt)?.toISOString() ?? null,
      originalCheckInAt: record.checkInAt?.toISOString() ?? null,
      originalCheckOutAt: record.checkOutAt?.toISOString() ?? null,
      checkInDistanceMeters: record.checkInDistanceMeters ? Number(record.checkInDistanceMeters) : null,
      checkInAccuracyMeters: record.checkInAccuracyMeters ? Number(record.checkInAccuracyMeters) : null,
      checkInVerification: record.checkInVerification,
      checkOutDistanceMeters: record.checkOutDistanceMeters ? Number(record.checkOutDistanceMeters) : null,
      checkOutAccuracyMeters: record.checkOutAccuracyMeters ? Number(record.checkOutAccuracyMeters) : null,
      checkOutVerification: record.checkOutVerification,
      status: record.adjustedStatus ?? record.status,
      originalStatus: record.status,
      workDurationMinutes: record.workDurationMinutes,
      checkInPhotoUrl: proofPhotoUrl,
      events: record.events.map((e) => ({
        id: e.id,
        type: e.type,
        occurredAt: e.occurredAt.toISOString(),
        metadata: e.metadata,
      })),
    };
  }
}
