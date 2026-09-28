import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RegistrationRequestStatus } from '@prisma/client';
import { resolveRegistrationRequestSchema } from '@workforce/contracts';
import {
  CurrentAdmin,
  CurrentOrganizationId,
} from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import { RbacGuard } from '../auth/guards/rbac.guard.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { RegistrationRequestsService } from './registration-requests.service.js';

@Controller()
@UseGuards(RbacGuard)
export class RegistrationRequestsController {
  constructor(
    private readonly registrationRequestsService: RegistrationRequestsService,
  ) {}

  @Get('registration-requests')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  async listRequests(
    @CurrentOrganizationId() orgId: string,
    @Query('status') status?: string,
  ) {
    const statusFilter =
      status && Object.values(RegistrationRequestStatus).includes(status as any)
        ? (status as RegistrationRequestStatus)
        : undefined;
    return this.registrationRequestsService.listRequests(orgId, statusFilter);
  }

  @Post('registration-requests/:id/resolve')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  async resolveRequest(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') requestId: string,
    @Body() body: unknown,
  ) {
    const input = resolveRegistrationRequestSchema.parse(body);
    return this.registrationRequestsService.resolveRequest(
      orgId,
      requestId,
      input,
      admin.userId,
    );
  }
}
