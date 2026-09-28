import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  assignPositionSchema,
  createPositionSchema,
  updatePositionSchema,
} from '@workforce/contracts';
import { CurrentAdmin, CurrentOrganizationId } from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import { RbacGuard } from '../auth/guards/rbac.guard.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { PositionsService } from './positions.service.js';

@Controller()
@UseGuards(RbacGuard)
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Post('positions')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  async createPosition(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: unknown,
  ) {
    const input = createPositionSchema.parse(body);
    return this.positionsService.createPosition(orgId, input, admin.userId);
  }

  @Get('positions')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  async listPositions(@CurrentOrganizationId() orgId: string) {
    return this.positionsService.listPositions(orgId);
  }

  @Get('positions/:id')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  async getPosition(
    @CurrentOrganizationId() orgId: string,
    @Param('id') positionId: string,
  ) {
    return this.positionsService.getPositionById(orgId, positionId);
  }

  @Patch('positions/:id')
  @RequireRoles('OWNER', 'HR')
  async updatePosition(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') positionId: string,
    @Body() body: unknown,
  ) {
    const input = updatePositionSchema.parse(body);
    return this.positionsService.updatePosition(orgId, positionId, input, admin.userId);
  }

  // Official Position Assignment Endpoint (Required Amendment 1)
  @Post('employees/:employeeId/position')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  async assignEmployeePosition(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ) {
    const input = assignPositionSchema.parse(body);
    return this.positionsService.assignEmployeePosition(orgId, employeeId, input, admin.userId);
  }

  @Get('employees/:employeeId/position-history')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  async getEmployeePositionHistory(
    @CurrentOrganizationId() orgId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.positionsService.getEmployeePositionHistory(orgId, employeeId);
  }
}
