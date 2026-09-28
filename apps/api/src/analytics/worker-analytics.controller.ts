import { Controller, Get } from '@nestjs/common';
import type { AttendanceHistoryItem, EmployeePerformanceAnalytics } from '@workforce/contracts';
import { CurrentWorker } from '../auth/decorators/principal.decorator.js';
import type { WorkerPrincipal } from '../auth/principal.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('worker')
export class WorkerAnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('analytics')
  async getMyAnalytics(@CurrentWorker() worker: WorkerPrincipal): Promise<EmployeePerformanceAnalytics> {
    return this.analyticsService.getEmployeeAnalytics(worker.organizationId, worker.employeeId);
  }

  @Get('history')
  async getMyHistory(@CurrentWorker() worker: WorkerPrincipal): Promise<AttendanceHistoryItem[]> {
    return this.analyticsService.getEmployeeAttendanceHistory(worker.organizationId, worker.employeeId);
  }
}
