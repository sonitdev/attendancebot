import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createAssignmentSchema,
  createEmployeeSchema,
  createProjectSchema,
  createSiteSchema,
  createWorkScheduleSchema,
  linkTelegramSchema,
  updateAssignmentSchema,
  updateEmployeeSchema,
  updateProjectSchema,
  updateSiteSchema,
  updateWorkScheduleSchema,
  updateTelegramReportGroupSchema,
  updateOrganizationSettingsSchema,
  uploadOrganizationLogoSchema,
  replaceAdminScopesSchema,
} from '@workforce/contracts';
import { CurrentOrganizationId, CurrentPrincipal } from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { AdminScopeService } from '../auth/admin-scope.service.js';
import { MapLinkResolverService } from './map-link-resolver.service.js';
import { AdminService } from './admin.service.js';

@Controller()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly mapLinkResolver: MapLinkResolverService,
    private readonly adminScope: AdminScopeService,
  ) {}

  @RequireRoles('OWNER', 'HR')
  @Get('admin-users/scopes')
  async listAdminAccessScopes(@CurrentOrganizationId() orgId: string) {
    return this.adminService.listAdminAccessScopes(orgId);
  }

  @RequireRoles('OWNER', 'HR')
  @Patch('admin-users/:id/scopes')
  async replaceAdminAccessScopes(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = replaceAdminScopesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    return this.adminService.replaceAdminAccessScopes(orgId, id, parsed.data, principal.userId);
  }

  @RequireRoles('OWNER', 'HR')
  @Post('employees')
  @HttpCode(HttpStatus.CREATED)
  async createEmployee(
    @CurrentOrganizationId() orgId: string,
    @Body() body: unknown,
  ) {
    const parseResult = createEmployeeSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.createEmployee(orgId, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR')
  @Patch('employees/:id')
  async updateEmployee(
    @CurrentOrganizationId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = updateEmployeeSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.updateEmployee(orgId, id, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR')
  @Delete('employees/:id')
  async deleteEmployee(
    @CurrentOrganizationId() orgId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.deleteEmployee(orgId, id);
  }

  @RequireRoles('OWNER', 'HR')
  @Post('projects')
  @HttpCode(HttpStatus.CREATED)
  async createProject(
    @CurrentOrganizationId() orgId: string,
    @Body() body: unknown,
  ) {
    const parseResult = createProjectSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.createProject(orgId, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Patch('projects/:id')
  async updateProject(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = updateProjectSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    await this.adminScope.assertProject(principal, id);
    return this.adminService.updateProject(orgId, id, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Delete('projects/:id')
  async deleteProject(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Param('id') id: string,
  ) {
    await this.adminScope.assertProject(principal, id);
    return this.adminService.deleteProject(orgId, id);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post('sites')
  @HttpCode(HttpStatus.CREATED)
  async createSite(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Body() body: unknown,
  ) {
    const parseResult = createSiteSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    await this.adminScope.assertProject(principal, parseResult.data.projectId);
    return this.adminService.createSite(orgId, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Patch('sites/:id')
  async updateSite(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = updateSiteSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    await this.adminScope.assertSite(principal, id);
    return this.adminService.updateSite(orgId, id, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Delete('sites/:id')
  async deleteSite(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Param('id') id: string,
  ) {
    await this.adminScope.assertSite(principal, id);
    return this.adminService.deleteSite(orgId, id);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post('schedules')
  @HttpCode(HttpStatus.CREATED)
  async createSchedule(
    @CurrentOrganizationId() orgId: string,
    @Body() body: unknown,
  ) {
    const parseResult = createWorkScheduleSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.createWorkSchedule(orgId, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Patch('schedules/:id')
  async updateSchedule(
    @CurrentOrganizationId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = updateWorkScheduleSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.updateWorkSchedule(orgId, id, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Delete('schedules/:id')
  async deleteSchedule(
    @CurrentOrganizationId() orgId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.deleteWorkSchedule(orgId, id);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post('assignments')
  @HttpCode(HttpStatus.CREATED)
  async createAssignment(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Body() body: unknown,
  ) {
    const parseResult = createAssignmentSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    await this.adminScope.assertSite(principal, parseResult.data.siteId);
    return this.adminService.createAssignment(orgId, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Patch('assignments/:id')
  async updateAssignment(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = updateAssignmentSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    await this.adminScope.assertAssignment(principal, id);
    if (parseResult.data.siteId) await this.adminScope.assertSite(principal, parseResult.data.siteId);
    return this.adminService.updateAssignment(orgId, id, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Delete('assignments/:id')
  async deleteAssignment(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Param('id') id: string,
  ) {
    await this.adminScope.assertAssignment(principal, id);
    return this.adminService.deleteAssignment(orgId, id);
  }

  @RequireRoles('OWNER', 'HR')
  @Get('telegram-report-groups')
  async listTelegramReportGroups(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal) {
    return this.adminService.listTelegramReportGroups(orgId, await this.adminScope.resolve(principal));
  }

  @RequireRoles('OWNER')
  @Post('telegram/owner-pairing')
  async createTelegramOwnerPairing(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
  ) {
    return this.adminService.createTelegramOwnerPairing(orgId, principal.userId);
  }

  @RequireRoles('OWNER', 'HR')
  @Patch('telegram-report-groups/:id')
  async updateTelegramReportGroup(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal, @Param('id') id: string, @Body() body: unknown) {
    return this.adminService.updateTelegramReportGroup(orgId, id, updateTelegramReportGroupSchema.parse(body), principal.userId);
  }

  @RequireRoles('OWNER', 'HR')
  @Post('telegram/link')
  @HttpCode(HttpStatus.OK)
  async linkTelegram(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Body() body: unknown,
  ) {
    const parseResult = linkTelegramSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.linkTelegramAccount(orgId, parseResult.data, principal.userId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('employees')
  async listEmployees(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal) {
    return this.adminService.listEmployees(orgId, await this.adminScope.resolve(principal));
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('projects')
  async listProjects(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal) {
    return this.adminService.listProjects(orgId, await this.adminScope.resolve(principal));
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('projects/:id')
  async getProjectDetail(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal, @Param('id') id: string) {
    return this.adminService.getProjectDetail(orgId, id, await this.adminScope.resolve(principal));
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post('projects/:id/telegram-health')
  async refreshProjectTelegramHealth(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() admin: AdminPrincipal, @Param('id') id: string) {
    await this.adminScope.assertProject(admin, id);
    return this.adminService.refreshProjectTelegramHealth(orgId, id, admin.userId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('employees/:id')
  async getEmployeeDetail(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal, @Param('id') id: string) {
    return this.adminService.getEmployeeDetail(orgId, id, await this.adminScope.resolve(principal));
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('security-events')
  async listSecurityEvents(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal, @Query('limit') limit?: string) {
    return this.adminService.listSecurityEvents(orgId, Math.min(Math.max(Number(limit) || 100, 1), 200), await this.adminScope.resolve(principal));
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('settings')
  async getSettings(@CurrentOrganizationId() orgId: string) {
    return this.adminService.getOrganizationSettings(orgId);
  }

  @RequireRoles('OWNER', 'HR')
  @Patch('settings')
  async updateSettings(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal, @Body() body: unknown) {
    const parsed = updateOrganizationSettingsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    return this.adminService.updateOrganizationSettings(orgId, parsed.data, principal.userId);
  }

  @RequireRoles('OWNER', 'HR')
  @Post('settings/logo')
  async uploadLogo(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal, @Body() body: unknown) {
    const parsed = uploadOrganizationLogoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    return this.adminService.uploadOrganizationLogo(orgId, parsed.data.imageDataUrl, principal.userId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('sites')
  async listSites(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal) {
    return this.adminService.listSites(orgId, await this.adminScope.resolve(principal));
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('map-links/resolve')
  async resolveMapLink(@Query('url') url?: string) {
    if (!url || url.length > 2_000) {
      throw new BadRequestException('INVALID_MAP_LINK');
    }
    return this.mapLinkResolver.resolve(url);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('schedules')
  async listSchedules(@CurrentOrganizationId() orgId: string) {
    return this.adminService.listWorkSchedules(orgId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get('assignments')
  async listAssignments(@CurrentOrganizationId() orgId: string, @CurrentPrincipal() principal: AdminPrincipal) {
    return this.adminService.listAssignments(orgId, await this.adminScope.resolve(principal));
  }

  @RequireRoles('OWNER', 'HR')
  @Get('audit-logs')
  async listAuditLogs(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: AdminPrincipal,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100) : 50;
    return this.adminService.listAuditLogs(orgId, parsedLimit, await this.adminScope.resolve(principal));
  }
}
