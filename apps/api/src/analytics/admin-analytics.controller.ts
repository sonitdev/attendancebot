import { Controller, Get, Param } from '@nestjs/common';
import type { AttendanceHistoryItem, EmployeePerformanceAnalytics } from '@workforce/contracts';
import { CurrentOrganizationId } from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('employees')
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get(':id/analytics')
  async getEmployeeAnalytics(
    @CurrentOrganizationId() organizationId: string,
    @Param('id') id: string,
  ): Promise<EmployeePerformanceAnalytics> {
    return this.analyticsService.getEmployeeAnalytics(organizationId, id);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get(':id/history')
  async getEmployeeHistory(
    @CurrentOrganizationId() organizationId: string,
    @Param('id') id: string,
  ): Promise<AttendanceHistoryItem[]> {
    return this.analyticsService.getEmployeeAttendanceHistory(organizationId, id);
  }
}
