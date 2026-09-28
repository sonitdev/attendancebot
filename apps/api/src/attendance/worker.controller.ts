import { Controller, Get } from '@nestjs/common';
import type { WorkerTodayResponse } from '@workforce/contracts';
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
}
