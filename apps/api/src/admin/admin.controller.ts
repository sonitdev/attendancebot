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
} from '@workforce/contracts';
import { CurrentOrganizationId, CurrentPrincipal } from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { MapLinkResolverService } from './map-link-resolver.service.js';
import { AdminService } from './admin.service.js';

@Controller()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly mapLinkResolver: MapLinkResolverService,
  ) {}

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

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
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
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = updateProjectSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.updateProject(orgId, id, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Delete('projects/:id')
  async deleteProject(
    @CurrentOrganizationId() orgId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.deleteProject(orgId, id);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post('sites')
  @HttpCode(HttpStatus.CREATED)
  async createSite(
    @CurrentOrganizationId() orgId: string,
    @Body() body: unknown,
  ) {
    const parseResult = createSiteSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.createSite(orgId, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Patch('sites/:id')
  async updateSite(
    @CurrentOrganizationId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = updateSiteSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.updateSite(orgId, id, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Delete('sites/:id')
  async deleteSite(
    @CurrentOrganizationId() orgId: string,
    @Param('id') id: string,
  ) {
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
    @Body() body: unknown,
  ) {
    const parseResult = createAssignmentSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.createAssignment(orgId, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Patch('assignments/:id')
  async updateAssignment(
    @CurrentOrganizationId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = updateAssignmentSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parseResult.error.errors });
    }
    return this.adminService.updateAssignment(orgId, id, parseResult.data);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Delete('assignments/:id')
  async deleteAssignment(
    @CurrentOrganizationId() orgId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.deleteAssignment(orgId, id);
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

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('employees')
  async listEmployees(@CurrentOrganizationId() orgId: string) {
    return this.adminService.listEmployees(orgId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('projects')
  async listProjects(@CurrentOrganizationId() orgId: string) {
    return this.adminService.listProjects(orgId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('sites')
  async listSites(@CurrentOrganizationId() orgId: string) {
    return this.adminService.listSites(orgId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('map-links/resolve')
  async resolveMapLink(@Query('url') url?: string) {
    if (!url || url.length > 2_000) {
      throw new BadRequestException('INVALID_MAP_LINK');
    }
    return this.mapLinkResolver.resolve(url);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('schedules')
  async listSchedules(@CurrentOrganizationId() orgId: string) {
    return this.adminService.listWorkSchedules(orgId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('assignments')
  async listAssignments(@CurrentOrganizationId() orgId: string) {
    return this.adminService.listAssignments(orgId);
  }

  @RequireRoles('OWNER', 'HR')
  @Get('audit-logs')
  async listAuditLogs(
    @CurrentOrganizationId() orgId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100) : 50;
    return this.adminService.listAuditLogs(orgId, parsedLimit);
  }
}
