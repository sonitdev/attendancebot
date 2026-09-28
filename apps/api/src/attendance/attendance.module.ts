import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { CorrectionService } from './correction.service.js';
import { WorkerController } from './worker.controller.js';

@Module({
  controllers: [AttendanceController, WorkerController],
  providers: [AttendanceService, CorrectionService],
  exports: [AttendanceService, CorrectionService],
})
export class AttendanceModule {}
