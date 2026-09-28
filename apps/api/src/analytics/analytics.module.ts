import { Module } from '@nestjs/common';
import { AdminAnalyticsController } from './admin-analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { WorkerAnalyticsController } from './worker-analytics.controller.js';

@Module({
  controllers: [WorkerAnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
