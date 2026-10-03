import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateOutletInput,
  UpdateDailySalesReportInput,
  UpdateOutletInput,
  UpdateSalesVisitContextInput,
} from '@workforce/contracts';
import type { WorkerPrincipal } from '../auth/principal.js';
import { ProjectAuthorizationService } from '../auth/project-authorization.service.js';
import { getSiteDate } from '../attendance/schedule-evaluator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminDataScope } from '../auth/admin-scope.service.js';

@Injectable()
export class SalesService {
  private static readonly MAX_SIGNED_PHOTO_CACHE_ENTRIES = 500;
  private readonly signedPhotoCache = new Map<string, { url: string | null; expiresAt: number }>();
  private readonly signingPhotoRequests = new Map<string, Promise<string | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAuth: ProjectAuthorizationService,
  ) {}

  private async signVisitPhotoUrl(storagePath: string | null): Promise<string | null> {
    if (!storagePath) return null;
    const now = Date.now();
    const cached = this.signedPhotoCache.get(storagePath);
    if (cached && cached.expiresAt > now) return cached.url;

    const inFlight = this.signingPhotoRequests.get(storagePath);
    if (inFlight) return inFlight;

    const request = (async () => {
      const baseUrl = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!baseUrl || !serviceKey) return null;
      try {
        const res = await fetch(`${baseUrl}/storage/v1/object/sign/attendance-evidence/${storagePath}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 300 }),
        });
        if (!res.ok) return null;
        const payload = (await res.json()) as { signedURL?: string; signedUrl?: string };
        const signedPath = payload.signedURL ?? payload.signedUrl;
        return signedPath ? (signedPath.startsWith('http') ? signedPath : `${baseUrl}/storage/v1${signedPath}`) : null;
      } catch {
        return null;
      }
    })();
    this.signingPhotoRequests.set(storagePath, request);
    try {
      const url = await request;
      if (this.signedPhotoCache.size >= SalesService.MAX_SIGNED_PHOTO_CACHE_ENTRIES) {
        const oldestKey = this.signedPhotoCache.keys().next().value;
        if (oldestKey) this.signedPhotoCache.delete(oldestKey);
      }
      this.signedPhotoCache.set(storagePath, { url, expiresAt: now + 240_000 });
      return url;
    } finally {
      this.signingPhotoRequests.delete(storagePath);
    }
  }

  async listWorkerOutlets(principal: WorkerPrincipal) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: principal.employeeId, organizationId: principal.organizationId, status: 'ACTIVE' },
      include: { currentProject: true },
    });
    if (!employee?.currentProject || employee.currentProject.workMode !== 'SALES' || employee.currentProject.status !== 'ACTIVE') {
      throw new BadRequestException('CURRENT_PROJECT_IS_NOT_SALES');
    }
    await this.projectAuth.authorizeWorkerProject(principal, employee.currentProject.id, 'SALES_OUTLET');
    return this.prisma.outlet.findMany({
      where: { organizationId: principal.organizationId, projectId: employee.currentProject.id, status: 'ACTIVE' },
      select: { id: true, name: true, code: true, address: true },
      orderBy: { name: 'asc' },
    });
  }

  async listOutlets(organizationId: string, projectId?: string, scope?: AdminDataScope) {
    const outlets = await this.prisma.outlet.findMany({
      where: { organizationId, ...(projectId ? { projectId } : {}), ...(!scope || scope.unrestricted ? {} : { projectId: { in: scope.projectIds } }) },
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return outlets.map((outlet) => ({
      ...outlet,
      latitude: outlet.latitude == null ? null : Number(outlet.latitude),
      longitude: outlet.longitude == null ? null : Number(outlet.longitude),
      createdAt: outlet.createdAt.toISOString(),
      updatedAt: outlet.updatedAt.toISOString(),
    }));
  }

  async createOutlet(organizationId: string, input: CreateOutletInput, actorUserId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, organizationId, workMode: 'SALES', status: 'ACTIVE' },
    });
    if (!project) throw new NotFoundException('ACTIVE_SALES_PROJECT_NOT_FOUND');
    return this.prisma.$transaction(async (tx) => {
      const outlet = await tx.outlet.create({ data: { organizationId, ...input } });
      await tx.auditLog.create({ data: { organizationId, actorUserId, action: 'SALES_OUTLET_CREATED', targetType: 'Outlet', targetId: outlet.id, metadata: { projectId: project.id, name: outlet.name } } });
      return outlet;
    });
  }

  async updateOutlet(organizationId: string, id: string, input: UpdateOutletInput, actorUserId: string) {
    const existing = await this.prisma.outlet.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('OUTLET_NOT_FOUND');
    if (input.projectId) {
      const project = await this.prisma.project.findFirst({ where: { id: input.projectId, organizationId, workMode: 'SALES', status: 'ACTIVE' } });
      if (!project) throw new NotFoundException('ACTIVE_SALES_PROJECT_NOT_FOUND');
    }
    return this.prisma.$transaction(async (tx) => {
      const outlet = await tx.outlet.update({ where: { id }, data: input });
      await tx.auditLog.create({ data: { organizationId, actorUserId, action: 'SALES_OUTLET_UPDATED', targetType: 'Outlet', targetId: id, metadata: { before: existing, after: input } } });
      return outlet;
    });
  }

  async getWorkerSalesDay(principal: WorkerPrincipal) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: principal.employeeId, organizationId: principal.organizationId },
      include: { currentProject: true },
    });
    if (!employee?.currentProject || employee.currentProject.workMode !== 'SALES') {
      throw new BadRequestException('CURRENT_PROJECT_IS_NOT_SALES');
    }

    await this.projectAuth.authorizeWorkerProject(principal, employee.currentProject.id, 'SALES_DAY');

    // Determine the site-local date for the worker's current project.
    // Use the site timezone from their active assignment under this project,
    // falling back to Asia/Phnom_Penh if no assignment exists yet.
    const activeAssignment = await this.prisma.assignment.findFirst({
      where: {
        organizationId: principal.organizationId,
        employeeId: principal.employeeId,
        status: 'ACTIVE',
        site: { projectId: employee.currentProject.id },
      },
      include: { site: true },
      orderBy: { startsOn: 'desc' },
    });
    const siteTimezone = activeAssignment?.site?.timezone ?? 'Asia/Phnom_Penh';
    const now = new Date();
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: siteTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const todayDate = new Date(`${todayStr}T00:00:00.000Z`);

    // Find today's open attendance record for the current SALES project.
    const attendance = await this.prisma.attendanceRecord.findFirst({
      where: {
        organizationId: principal.organizationId,
        employeeId: principal.employeeId,
        projectId: employee.currentProject.id,
        attendanceDate: todayDate,
      },
      include: { site: true, project: true },
    });
    if (!attendance) throw new NotFoundException('NO_SALES_ATTENDANCE');

    const report = await this.ensureDraftReport(principal, attendance.id);
    return this.buildWorkerReport(report.id, principal);
  }

  async ensureDraftReport(principal: WorkerPrincipal, attendanceRecordId: string) {
    const attendance = await this.prisma.attendanceRecord.findFirst({
      where: { id: attendanceRecordId, organizationId: principal.organizationId, employeeId: principal.employeeId },
      include: { project: true },
    });
    if (!attendance || attendance.project.workMode !== 'SALES') throw new NotFoundException('SALES_ATTENDANCE_NOT_FOUND');

    await this.projectAuth.authorizeWorkerProject(principal, attendance.projectId, 'SALES_REPORT');

    return this.prisma.$transaction(async (tx) => {
      const report = await tx.dailySalesReport.upsert({
        where: { attendanceRecordId: attendance.id },
        create: {
          organizationId: principal.organizationId,
          employeeId: principal.employeeId,
          projectId: attendance.projectId,
          attendanceRecordId: attendance.id,
          reportDate: attendance.attendanceDate,
        },
        update: {},
      });
      const visits = await tx.visitLog.findMany({
        where: { organizationId: principal.organizationId, employeeId: principal.employeeId, attendanceRecordId: attendance.id },
        select: { id: true },
      });
      for (const visit of visits) {
        await tx.dailySalesReportVisit.upsert({
          where: { reportId_visitLogId: { reportId: report.id, visitLogId: visit.id } },
          create: { reportId: report.id, visitLogId: visit.id },
          update: {},
        });
      }
      return report;
    });
  }

  async updateVisitContext(
    principal: WorkerPrincipal,
    reportId: string,
    visitId: string,
    input: UpdateSalesVisitContextInput,
  ) {
    const report = await this.prisma.dailySalesReport.findFirst({ where: { id: reportId, organizationId: principal.organizationId, employeeId: principal.employeeId, status: 'DRAFT' } });
    if (!report) throw new NotFoundException('DRAFT_REPORT_NOT_FOUND');
    await this.projectAuth.authorizeWorkerProject(principal, report.projectId, 'SALES_REPORT');
    const reportVisit = await this.prisma.dailySalesReportVisit.findFirst({ where: { reportId, visitLogId: visitId } });
    if (!reportVisit) throw new NotFoundException('REPORT_VISIT_NOT_FOUND');
    return this.prisma.$transaction(async (tx) => {
      await tx.visitLog.update({
        where: { id: visitId },
        data: {
          visitResult: input.visitResult,
          followUpRequired: input.followUpRequired ?? false,
          followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
          potentialOrderQuantity: input.potentialOrderQuantity,
          requestedDiscountPerItem: input.requestedDiscountPerItem,
        },
      });
      return tx.dailySalesReportVisit.update({
        where: { id: reportVisit.id },
        data: {
          workerStatement: input.workerStatement,
          structuredContext: {
            visitResult: input.visitResult ?? null,
            followUpRequired: input.followUpRequired ?? false,
            followUpAt: input.followUpAt ?? null,
            potentialOrderQuantity: input.potentialOrderQuantity ?? null,
            requestedDiscountPerItem: input.requestedDiscountPerItem ?? null,
          },
        },
      });
    });
  }

  async updateReport(principal: WorkerPrincipal, reportId: string, input: UpdateDailySalesReportInput) {
    const report = await this.prisma.dailySalesReport.findFirst({ where: { id: reportId, organizationId: principal.organizationId, employeeId: principal.employeeId, status: 'DRAFT' } });
    if (!report) throw new NotFoundException('DRAFT_REPORT_NOT_FOUND');
    await this.projectAuth.authorizeWorkerProject(principal, report.projectId, 'SALES_REPORT');
    await this.prisma.dailySalesReport.update({ where: { id: report.id }, data: input });
    return this.buildWorkerReport(report.id, principal);
  }

  async getWorkerReport(principal: WorkerPrincipal, reportId: string) {
    const report = await this.prisma.dailySalesReport.findFirst({
      where: { id: reportId, organizationId: principal.organizationId, employeeId: principal.employeeId },
    });
    if (!report) throw new NotFoundException('SALES_REPORT_NOT_FOUND');
    await this.projectAuth.authorizeWorkerProject(principal, report.projectId, 'SALES_REPORT');
    return this.buildWorkerReport(reportId, principal);
  }

  async submitReport(principal: WorkerPrincipal, reportId: string) {
    const report = await this.prisma.dailySalesReport.findFirst({
      where: { id: reportId, organizationId: principal.organizationId, employeeId: principal.employeeId },
      include: { attendanceRecord: true, visits: { include: { visitLog: true } } },
    });
    if (!report) throw new NotFoundException('DRAFT_REPORT_NOT_FOUND');
    await this.projectAuth.authorizeWorkerProject(principal, report.projectId, 'SALES_REPORT');
    // Telegram/client retries must return the already-submitted report rather
    // than turning a successful first submission into a misleading error.
    if (report.status === 'SUBMITTED') return this.buildWorkerReport(report.id, principal);
    if (!report.attendanceRecord.checkOutAt && !report.attendanceRecord.adjustedCheckOutAt) throw new BadRequestException('END_WORK_REQUIRED_BEFORE_REPORT');
    const incomplete = report.visits.filter((item) => !item.workerStatement && !item.visitLog.note && !item.visitLog.visitResult);
    if (incomplete.length > 0) throw new BadRequestException({ code: 'REPORT_VISIT_CONTEXT_REQUIRED', visitIds: incomplete.map((item) => item.visitLogId) });

    const submittedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.dailySalesReport.update({ where: { id: report.id }, data: { status: 'SUBMITTED', submittedAt } });
      await tx.auditLog.create({ data: { organizationId: principal.organizationId, action: 'DAILY_SALES_REPORT_SUBMITTED', targetType: 'DailySalesReport', targetId: report.id, metadata: { employeeId: principal.employeeId, projectId: report.projectId, visitCount: report.visits.length } } });
    });
    return this.buildWorkerReport(report.id, principal);
  }

  private async buildWorkerReport(reportId: string, principal: WorkerPrincipal) {
    const report = await this.prisma.dailySalesReport.findFirst({
      where: { id: reportId, organizationId: principal.organizationId, employeeId: principal.employeeId },
      include: {
        project: { select: { id: true, name: true } },
        attendanceRecord: true,
        visits: { include: { visitLog: { include: { outlet: true } } } },
      },
    });
    if (!report) throw new NotFoundException('SALES_REPORT_NOT_FOUND');
    return {
      id: report.id,
      status: report.status,
      reportDate: report.reportDate.toISOString().slice(0, 10),
      project: report.project,
      attendance: {
        checkInAt: (report.attendanceRecord.adjustedCheckInAt ?? report.attendanceRecord.checkInAt)?.toISOString() ?? null,
        checkOutAt: (report.attendanceRecord.adjustedCheckOutAt ?? report.attendanceRecord.checkOutAt)?.toISOString() ?? null,
        status: report.attendanceRecord.adjustedStatus ?? report.attendanceRecord.status,
      },
      workerSummary: report.workerSummary,
      additionalNote: report.additionalNote,
      submittedAt: report.submittedAt?.toISOString() ?? null,
      visits: report.visits.sort((a, b) => a.visitLog.visitedAt.getTime() - b.visitLog.visitedAt.getTime()).map(({ visitLog, workerStatement, structuredContext }) => ({
        id: visitLog.id,
        outlet: visitLog.outlet ? { id: visitLog.outlet.id, name: visitLog.outlet.name } : null,
        customerName: visitLog.customerName,
        visitedAt: visitLog.visitedAt.toISOString(),
        latitude: Number(visitLog.latitude),
        longitude: Number(visitLog.longitude),
        note: visitLog.note,
        visitResult: visitLog.visitResult,
        followUpRequired: visitLog.followUpRequired,
        followUpAt: visitLog.followUpAt?.toISOString() ?? null,
        potentialOrderQuantity: visitLog.potentialOrderQuantity,
        requestedDiscountPerItem: visitLog.requestedDiscountPerItem == null ? null : Number(visitLog.requestedDiscountPerItem),
        workerStatement,
        structuredContext,
        needsContext: !workerStatement && !visitLog.note && !visitLog.visitResult,
      })),
    };
  }

  async getAdminOverview(organizationId: string, date?: string, projectId?: string, scope?: AdminDataScope) {
    const day = date ?? new Date().toISOString().slice(0, 10);
    const attendanceDate = new Date(`${day}T00:00:00.000Z`);
    const scopeProjectIds = !scope || scope.unrestricted ? undefined : scope.projectIds;
    const projectWhere = { organizationId, workMode: 'SALES' as const, ...(projectId ? { id: projectId } : scopeProjectIds ? { id: { in: scopeProjectIds } } : {}) };
    const visitWindowStart = new Date(attendanceDate.getTime() - 86_400_000);
    const visitWindowEnd = new Date(attendanceDate.getTime() + 172_800_000);
    const [projects, records, reports, candidateVisits, assignments] = await Promise.all([
      this.prisma.project.findMany({ where: projectWhere, select: { id: true, name: true } }),
      this.prisma.attendanceRecord.findMany({ where: { organizationId, attendanceDate, project: { workMode: 'SALES' }, ...(projectId ? { projectId } : scopeProjectIds ? { projectId: { in: scopeProjectIds } } : {}) }, include: { employee: true, project: true } }),
      this.prisma.dailySalesReport.findMany({ where: { organizationId, reportDate: attendanceDate, ...(projectId ? { projectId } : scopeProjectIds ? { projectId: { in: scopeProjectIds } } : {}) }, include: { employee: true, project: true, visits: true } }),
      this.prisma.visitLog.findMany({ where: { organizationId, project: { workMode: 'SALES' }, visitedAt: { gte: visitWindowStart, lt: visitWindowEnd }, ...(projectId ? { projectId } : scopeProjectIds ? { projectId: { in: scopeProjectIds } } : {}) }, include: { employee: true, project: true, outlet: true, site: { select: { timezone: true } } } }),
      this.prisma.assignment.findMany({ where: { organizationId, status: 'ACTIVE', site: { project: { workMode: 'SALES', ...(projectId ? { id: projectId } : scopeProjectIds ? { id: { in: scopeProjectIds } } : {}) } }, startsOn: { lte: attendanceDate }, OR: [{ endsOn: null }, { endsOn: { gte: attendanceDate } }] }, include: { employee: true } }),
    ]);
    const visits = candidateVisits.filter((visit) => getSiteDate(visit.visitedAt, visit.site.timezone) === day);
    const startedIds = new Set(records.filter((record) => record.checkInAt).map((record) => record.employeeId));
    const lateRecords = records.filter((record) => (record.adjustedStatus ?? record.status) === 'LATE');
    return {
      date: day,
      projects,
      summary: {
        assigned: assignments.length,
        started: startedIds.size,
        notStarted: assignments.filter((assignment) => !startedIds.has(assignment.employeeId)).length,
        late: lateRecords.length,
        visits: visits.length,
        uniqueOutlets: new Set(visits.map((visit) => visit.outletId ?? visit.customerName).filter(Boolean)).size,
        submittedReports: reports.filter((report) => report.status === 'SUBMITTED').length,
        missingReports: records.filter((record) => (record.adjustedCheckOutAt ?? record.checkOutAt) && !reports.some((report) => report.attendanceRecordId === record.id && report.status === 'SUBMITTED')).length,
        followUps: visits.filter((visit) => visit.followUpRequired).length,
        potentialOrders: visits.filter((visit) => visit.potentialOrderQuantity != null).length,
        discountRequests: visits.filter((visit) => visit.requestedDiscountPerItem != null).length,
      },
      attendance: records,
      notStarted: assignments.filter((assignment) => !startedIds.has(assignment.employeeId)).map((assignment) => assignment.employee),
      visits,
      reports,
    };
  }

  async archiveOutlet(organizationId: string, id: string, actorUserId: string) {
    const existing = await this.prisma.outlet.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('OUTLET_NOT_FOUND');
    return this.prisma.$transaction(async (tx) => {
      const outlet = await tx.outlet.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await tx.auditLog.create({ data: { organizationId, actorUserId, action: 'SALES_OUTLET_ARCHIVED', targetType: 'Outlet', targetId: id, metadata: { name: existing.name, projectId: existing.projectId } } });
      return outlet;
    });
  }

  async getAdminReportDetail(organizationId: string, reportId: string, scope?: AdminDataScope) {
    const report = await this.prisma.dailySalesReport.findFirst({
      where: { id: reportId, organizationId, ...(!scope || scope.unrestricted ? {} : { projectId: { in: scope.projectIds } }) },
      include: {
        project: { select: { id: true, name: true, workMode: true } },
        employee: { select: { id: true, employeeCode: true, fullName: true, jobTitle: true } },
        attendanceRecord: { select: { id: true, checkInAt: true, checkOutAt: true, adjustedCheckInAt: true, adjustedCheckOutAt: true, status: true, adjustedStatus: true } },
        visits: {
          include: {
            visitLog: {
              include: { outlet: { select: { id: true, name: true, code: true } } },
            },
          },
          orderBy: { visitLog: { visitedAt: 'asc' } },
        },
      },
    });
    if (!report) throw new NotFoundException('SALES_REPORT_NOT_FOUND');

    const visitsWithUrls = await Promise.all(
      report.visits.map(async ({ visitLog, workerStatement, structuredContext }) => ({
        id: visitLog.id,
        outlet: visitLog.outlet ?? null,
        customerName: visitLog.customerName,
        visitedAt: visitLog.visitedAt.toISOString(),
        latitude: Number(visitLog.latitude),
        longitude: Number(visitLog.longitude),
        proofPhotoUrl: await this.signVisitPhotoUrl(visitLog.proofPhotoPath),
        note: visitLog.note,
        visitResult: visitLog.visitResult,
        followUpRequired: visitLog.followUpRequired,
        followUpAt: visitLog.followUpAt?.toISOString() ?? null,
        potentialOrderQuantity: visitLog.potentialOrderQuantity,
        requestedDiscountPerItem: visitLog.requestedDiscountPerItem == null ? null : Number(visitLog.requestedDiscountPerItem),
        workerStatement,
        structuredContext,
        needsContext: !workerStatement && !visitLog.note && !visitLog.visitResult,
      })),
    );

    return {
      id: report.id,
      status: report.status,
      reportDate: report.reportDate.toISOString().slice(0, 10),
      submittedAt: report.submittedAt?.toISOString() ?? null,
      project: report.project,
      employee: report.employee,
      attendance: {
        id: report.attendanceRecord.id,
        checkInAt: (report.attendanceRecord.adjustedCheckInAt ?? report.attendanceRecord.checkInAt)?.toISOString() ?? null,
        checkOutAt: (report.attendanceRecord.adjustedCheckOutAt ?? report.attendanceRecord.checkOutAt)?.toISOString() ?? null,
        status: report.attendanceRecord.adjustedStatus ?? report.attendanceRecord.status,
      },
      workerSummary: report.workerSummary,
      additionalNote: report.additionalNote,
      visits: visitsWithUrls,
    };
  }
}
