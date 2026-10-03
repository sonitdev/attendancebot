import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { TelegramBotService } from './telegram-bot.service.js';
import { TelegramInitDataVerifier } from './telegram-init-data.verifier.js';
import { TelegramSessionController } from './telegram-session.controller.js';
import { TelegramSessionService } from './telegram-session.service.js';
import { TelegramWebhookController } from './telegram-webhook.controller.js';
import { RegistrationRequestsModule } from '../registration-requests/registration-requests.module.js';
import { SalesModule } from '../sales/sales.module.js';

@Module({
  imports: [AttendanceModule, JobsModule, SalesModule, RegistrationRequestsModule],
  controllers: [TelegramSessionController, TelegramWebhookController],
  providers: [TelegramInitDataVerifier, TelegramSessionService, TelegramBotService],
  exports: [TelegramInitDataVerifier, TelegramSessionService, TelegramBotService],
})
export class TelegramModule {}
