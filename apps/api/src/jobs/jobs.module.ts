import { Module } from '@nestjs/common';
import { AdminJobsController } from './admin-jobs.controller.js';
import { AttendanceJobsService } from './attendance-jobs.service.js';
import { TelegramNotifierService } from './telegram-notifier.service.js';
import { TelegramOutboxService } from './telegram-outbox.service.js';
import { TelegramHealthSyncService } from './telegram-health-sync.service.js';
import { TelegramDispatchQueueService } from './telegram-dispatch-queue.service.js';

@Module({
  controllers: [AdminJobsController],
  providers: [TelegramNotifierService, TelegramDispatchQueueService, TelegramOutboxService, TelegramHealthSyncService, AttendanceJobsService],
  exports: [TelegramNotifierService, TelegramOutboxService, AttendanceJobsService],
})
export class JobsModule {}
