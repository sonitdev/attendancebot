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
  createWorkerGroupSchema,
  manageWorkerGroupMembersSchema,
  updateWorkerGroupSchema,
} from '@workforce/contracts';
import { CurrentAdmin, CurrentOrganizationId } from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import { RbacGuard } from '../auth/guards/rbac.guard.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { WorkerGroupsService } from './worker-groups.service.js';

@Controller('worker-groups')
@UseGuards(RbacGuard)
export class WorkerGroupsController {
  constructor(private readonly workerGroupsService: WorkerGroupsService) {}

  @Post()
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  async createGroup(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: unknown,
  ) {
    const input = createWorkerGroupSchema.parse(body);
    return this.workerGroupsService.createGroup(orgId, input, admin.userId);
  }

  @Get()
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  async listGroups(@CurrentOrganizationId() orgId: string) {
    return this.workerGroupsService.listGroups(orgId);
  }

  @Get(':id')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  async getGroup(
    @CurrentOrganizationId() orgId: string,
    @Param('id') groupId: string,
  ) {
    return this.workerGroupsService.getGroupById(orgId, groupId);
  }

  @Patch(':id')
  @RequireRoles('OWNER', 'HR')
  async updateGroup(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') groupId: string,
    @Body() body: unknown,
  ) {
    const input = updateWorkerGroupSchema.parse(body);
    return this.workerGroupsService.updateGroup(orgId, groupId, input, admin.userId);
  }

  @Post(':id/members')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  async addMembers(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') groupId: string,
    @Body() body: unknown,
  ) {
    const input = manageWorkerGroupMembersSchema.parse(body);
    return this.workerGroupsService.addMembers(orgId, groupId, input, admin.userId);
  }

  @Post(':id/members/remove')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER')
  async removeMembers(
    @CurrentOrganizationId() orgId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') groupId: string,
    @Body() body: unknown,
  ) {
    const input = manageWorkerGroupMembersSchema.parse(body);
    return this.workerGroupsService.removeMembers(orgId, groupId, input, admin.userId);
  }

  @Get(':id/members')
  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  async listMembers(
    @CurrentOrganizationId() orgId: string,
    @Param('id') groupId: string,
  ) {
    return this.workerGroupsService.listGroupMembers(orgId, groupId);
  }
}
