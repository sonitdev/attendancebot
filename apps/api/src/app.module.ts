import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from './admin/admin.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/guards/auth.guard.js';
import { RbacGuard } from './auth/guards/rbac.guard.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PositionsModule } from './positions/positions.module.js';
import { PositionRequestsModule } from './position-requests/position-requests.module.js';
import { RegistrationRequestsModule } from './registration-requests/registration-requests.module.js';
import { WorkerGroupsModule } from './worker-groups/worker-groups.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    TelegramModule,
    AdminModule,
    AttendanceModule,
    AnalyticsModule,
    JobsModule,
    PositionsModule,
    PositionRequestsModule,
    RegistrationRequestsModule,
    WorkerGroupsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
  ],
})
export class AppModule {}
