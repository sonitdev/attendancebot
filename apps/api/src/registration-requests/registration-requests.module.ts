import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RegistrationRequestsController } from './registration-requests.controller.js';
import { RegistrationRequestsService } from './registration-requests.service.js';

@Module({
  imports: [PrismaModule, JobsModule],
  controllers: [RegistrationRequestsController],
  providers: [RegistrationRequestsService],
  exports: [RegistrationRequestsService],
})
export class RegistrationRequestsModule {}
