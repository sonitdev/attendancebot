import { Module } from '@nestjs/common';
import { AdminJobsController } from './admin-jobs.controller.js';
import { AttendanceJobsService } from './attendance-jobs.service.js';
import { TelegramNotifierService } from './telegram-notifier.service.js';

@Module({
  controllers: [AdminJobsController],
  providers: [TelegramNotifierService, AttendanceJobsService],
  exports: [TelegramNotifierService, AttendanceJobsService],
})
export class JobsModule {}
