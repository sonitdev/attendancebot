import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { recordVisitSchema, setCurrentProjectSchema, type WorkerTodayResponse } from '@workforce/contracts';
import { CurrentWorker } from '../auth/decorators/principal.decorator.js';
import type { WorkerPrincipal } from '../auth/principal.js';
import { AttendanceService } from './attendance.service.js';

@Controller('worker')
export class WorkerController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('today')
  async getToday(@CurrentWorker() worker: WorkerPrincipal): Promise<WorkerTodayResponse> {
    return this.attendanceService.getWorkerToday(worker);
  }

  @Get('projects')
  async listProjects(@CurrentWorker() worker: WorkerPrincipal) {
    return this.attendanceService.listConnectedProjects(worker);
  }

  @Post('current-project')
  @HttpCode(HttpStatus.OK)
  async setCurrentProject(@CurrentWorker() worker: WorkerPrincipal, @Body() body: unknown) {
    const parsed = setCurrentProjectSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    return this.attendanceService.setCurrentProject(worker, parsed.data.projectId);
  }

  @Post('visits')
  @HttpCode(HttpStatus.OK)
  async recordVisit(@CurrentWorker() worker: WorkerPrincipal, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    if (!key?.trim()) throw new BadRequestException('MISSING_IDEMPOTENCY_KEY');
    const parsed = recordVisitSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    return this.attendanceService.recordVisit(worker, parsed.data, key.trim());
  }
}
