import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { BulkAssignmentsController } from '../assignments/bulk-assignments.controller.js';
import { BulkAssignmentsService } from '../assignments/bulk-assignments.service.js';
import { MapLinkResolverService } from './map-link-resolver.service.js';
import { AdminService } from './admin.service.js';

@Module({
  controllers: [AdminController, BulkAssignmentsController],
  providers: [AdminService, MapLinkResolverService, BulkAssignmentsService],
  exports: [AdminService, BulkAssignmentsService],
})
export class AdminModule {}

