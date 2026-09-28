import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { CurrentOrganizationId } from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import { AttendanceJobsService, type DailyOperationalReport } from './attendance-jobs.service.js';

@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly jobsService: AttendanceJobsService) {}

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post('evaluate-missing-checkouts')
  @HttpCode(HttpStatus.OK)
  async runMissingCheckoutEvaluation(@CurrentOrganizationId() organizationId: string) {
    return this.jobsService.evaluateMissingCheckouts(organizationId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post('evaluate-absences')
  @HttpCode(HttpStatus.OK)
  async runAbsenceEvaluation(@CurrentOrganizationId() organizationId: string) {
    return this.jobsService.evaluateAbsences(organizationId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post('send-reminders')
  @HttpCode(HttpStatus.OK)
  async runShiftReminders(@CurrentOrganizationId() organizationId: string) {
    return this.jobsService.sendShiftReminders(organizationId);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('daily-report')
  async getDailyReport(
    @CurrentOrganizationId() organizationId: string,
    @Query('date') date?: string,
  ): Promise<DailyOperationalReport> {
    return this.jobsService.generateDailyReport(organizationId, date);
  }
}
