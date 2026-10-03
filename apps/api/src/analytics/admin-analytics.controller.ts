import { Controller, Get, Param } from '@nestjs/common';
import type { AttendanceHistoryItem, EmployeePerformanceAnalytics } from '@workforce/contracts';
import { CurrentAdmin, CurrentOrganizationId } from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { AdminScopeService } from '../auth/admin-scope.service.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('employees')
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService, private readonly adminScope: AdminScopeService) {}

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get(':id/analytics')
  async getEmployeeAnalytics(
    @CurrentOrganizationId() organizationId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
  ): Promise<EmployeePerformanceAnalytics> {
    await this.adminScope.assertEmployee(admin, id);
    return this.analyticsService.getEmployeeAnalytics(organizationId, id, await this.adminScope.resolve(admin));
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER', 'VIEWER')
  @Get(':id/history')
  async getEmployeeHistory(
    @CurrentOrganizationId() organizationId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
  ): Promise<AttendanceHistoryItem[]> {
    await this.adminScope.assertEmployee(admin, id);
    return this.analyticsService.getEmployeeAttendanceHistory(organizationId, id, 50, await this.adminScope.resolve(admin));
  }
}
