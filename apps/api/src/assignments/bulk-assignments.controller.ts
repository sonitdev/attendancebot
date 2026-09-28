import {
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  bulkAssignmentApplyInputSchema,
  bulkAssignmentPreviewInputSchema,
} from '@workforce/contracts';
import { CurrentAdmin, CurrentOrganizationId } from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import { RbacGuard } from '../auth/guards/rbac.guard.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { BulkAssignmentsService } from './bulk-assignments.service.js';

@Controller('assignments/bulk')
@UseGuards(RbacGuard)
export class BulkAssignmentsController {
  constructor(private readonly bulkAssignmentsService: BulkAssignmentsService) {}

  @Post('preview')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  async previewAssignments(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: unknown,
  ) {
    const input = bulkAssignmentPreviewInputSchema.parse(body);
    return this.bulkAssignmentsService.previewAssignments(orgId, input, admin.userId);
  }

  @Post('apply')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  async applyAssignments(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: unknown,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    const rawInput = (typeof body === 'object' && body !== null) ? body : {};
    const idempotencyKey = (rawInput as any).idempotencyKey || headerIdempotencyKey;

    const input = bulkAssignmentApplyInputSchema.parse({
      ...rawInput,
      idempotencyKey,
    });

    return this.bulkAssignmentsService.applyAssignments(orgId, input, admin.userId);
  }
}
