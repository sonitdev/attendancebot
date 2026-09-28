import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PositionRequestsController } from './position-requests.controller.js';
import { PositionRequestsService } from './position-requests.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PositionRequestsController],
  providers: [PositionRequestsService],
  exports: [PositionRequestsService],
})
export class PositionRequestsModule {}
