import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createOutletSchema,
  updateDailySalesReportSchema,
  updateOutletSchema,
  updateSalesVisitContextSchema,
} from '@workforce/contracts';
import { CurrentAdmin, CurrentOrganizationId, CurrentWorker } from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import type { AdminPrincipal, WorkerPrincipal } from '../auth/principal.js';
import { AdminScopeService } from '../auth/admin-scope.service.js';
import { SalesService } from './sales.service.js';

@Controller()
export class SalesController {
  constructor(private readonly sales: SalesService, private readonly adminScope: AdminScopeService) {}

  @Get('worker/sales-day')
  getWorkerSalesDay(@CurrentWorker() worker: WorkerPrincipal) {
    return this.sales.getWorkerSalesDay(worker);
  }

  @Get('worker/sales-outlets')
  getWorkerOutlets(@CurrentWorker() worker: WorkerPrincipal) {
    return this.sales.listWorkerOutlets(worker);
  }

  @Post('worker/sales-reports/:attendanceId/draft')
  createDraft(@CurrentWorker() worker: WorkerPrincipal, @Param('attendanceId') attendanceId: string) {
    return this.sales.ensureDraftReport(worker, attendanceId);
  }

  @Patch('worker/sales-reports/:reportId/visits/:visitId')
  updateVisit(@CurrentWorker() worker: WorkerPrincipal, @Param('reportId') reportId: string, @Param('visitId') visitId: string, @Body() body: unknown) {
    const parsed = updateSalesVisitContextSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    return this.sales.updateVisitContext(worker, reportId, visitId, parsed.data);
  }

  @Patch('worker/sales-reports/:reportId')
  updateReport(@CurrentWorker() worker: WorkerPrincipal, @Param('reportId') reportId: string, @Body() body: unknown) {
    const parsed = updateDailySalesReportSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    return this.sales.updateReport(worker, reportId, parsed.data);
  }

  @Post('worker/sales-reports/:reportId/submit')
  submitReport(@CurrentWorker() worker: WorkerPrincipal, @Param('reportId') reportId: string) {
    return this.sales.submitReport(worker, reportId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('sales/overview')
  async overview(@CurrentOrganizationId() orgId: string, @CurrentAdmin() admin: AdminPrincipal, @Query('date') date?: string, @Query('projectId') projectId?: string) {
    if (projectId) await this.adminScope.assertProject(admin, projectId);
    return this.sales.getAdminOverview(orgId, date, projectId, await this.adminScope.resolve(admin));
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('sales/outlets')
  async listOutlets(@CurrentOrganizationId() orgId: string, @CurrentAdmin() admin: AdminPrincipal, @Query('projectId') projectId?: string) {
    if (projectId) await this.adminScope.assertProject(admin, projectId);
    return this.sales.listOutlets(orgId, projectId, await this.adminScope.resolve(admin));
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  @Post('sales/outlets')
  async createOutlet(@CurrentOrganizationId() orgId: string, @CurrentAdmin() admin: AdminPrincipal, @Body() body: unknown) {
    const parsed = createOutletSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    await this.adminScope.assertProject(admin, parsed.data.projectId);
    return this.sales.createOutlet(orgId, parsed.data, admin.userId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  @Patch('sales/outlets/:id')
  async updateOutlet(@CurrentOrganizationId() orgId: string, @CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body() body: unknown) {
    const parsed = updateOutletSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    await this.adminScope.assertOutlet(admin, id);
    if (parsed.data.projectId) await this.adminScope.assertProject(admin, parsed.data.projectId);
    return this.sales.updateOutlet(orgId, id, parsed.data, admin.userId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  @Post('sales/outlets/:id/archive')
  @HttpCode(HttpStatus.OK)
  async archiveOutlet(@CurrentOrganizationId() orgId: string, @CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    await this.adminScope.assertOutlet(admin, id);
    return this.sales.archiveOutlet(orgId, id, admin.userId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('sales/reports/:reportId')
  async getAdminReportDetail(@CurrentOrganizationId() orgId: string, @CurrentAdmin() admin: AdminPrincipal, @Param('reportId') reportId: string) {
    await this.adminScope.assertSalesReport(admin, reportId);
    return this.sales.getAdminReportDetail(orgId, reportId, await this.adminScope.resolve(admin));
  }
}
