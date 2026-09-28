import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WorkerGroupsController } from './worker-groups.controller.js';
import { WorkerGroupsService } from './worker-groups.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [WorkerGroupsController],
  providers: [WorkerGroupsService],
  exports: [WorkerGroupsService],
})
export class WorkerGroupsModule {}
