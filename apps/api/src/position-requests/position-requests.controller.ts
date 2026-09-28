import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PositionRequestStatus } from '@prisma/client';
import {
  createPositionRequestSchema,
  resolvePositionRequestSchema,
} from '@workforce/contracts';
import {
  CurrentAdmin,
  CurrentOrganizationId,
  CurrentPrincipal,
} from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import { RbacGuard } from '../auth/guards/rbac.guard.js';
import { isAdminPrincipal, type AdminPrincipal, type Principal } from '../auth/principal.js';
import { PositionRequestsService } from './position-requests.service.js';

@Controller()
@UseGuards(RbacGuard)
export class PositionRequestsController {
  constructor(private readonly positionRequestsService: PositionRequestsService) {}

  @Post('position-requests')
  async createRequest(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ) {
    const input = createPositionRequestSchema.parse(body);

    let employeeId: string;
    if (principal.type === 'worker') {
      employeeId = principal.employeeId;
    } else {
      // If admin submits on behalf of worker, check body.employeeId or principal context
      employeeId = (body as any).employeeId ?? principal.userId;
    }

    return this.positionRequestsService.createRequest(orgId, employeeId, input);
  }

  @Get('position-requests')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  async listRequests(
    @CurrentOrganizationId() orgId: string,
    @Query('status') status?: string,
  ) {
    const statusFilter = status && Object.values(PositionRequestStatus).includes(status as any)
      ? (status as PositionRequestStatus)
      : undefined;
    return this.positionRequestsService.listRequests(orgId, statusFilter);
  }

  @Post('position-requests/:id/resolve')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  async resolveRequest(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') requestId: string,
    @Body() body: unknown,
  ) {
    const input = resolvePositionRequestSchema.parse(body);
    return this.positionRequestsService.resolveRequest(orgId, requestId, input, admin.userId);
  }

  @Get('worker/position-request/pending')
  async getEmployeePendingRequest(
    @CurrentOrganizationId() orgId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    const employeeId = principal.type === 'worker' ? principal.employeeId : principal.userId;
    return this.positionRequestsService.getEmployeePendingRequest(orgId, employeeId);
  }
}
