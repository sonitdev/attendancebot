import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateWorkerGroupInput,
  ManageWorkerGroupMembersInput,
  UpdateWorkerGroupInput,
} from '@workforce/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class WorkerGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async createGroup(orgId: string, input: CreateWorkerGroupInput, actorUserId: string | null) {
    const existing = await this.prisma.workerGroup.findUnique({
      where: {
        organizationId_code: {
          organizationId: orgId,
          code: input.code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Worker group code '${input.code}' already exists in this organization`);
    }

    const group = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workerGroup.create({
        data: {
          organizationId: orgId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId,
          action: 'WORKER_GROUP_CREATED',
          targetType: 'WorkerGroup',
          targetId: created.id,
          metadata: {
            code: created.code,
            name: created.name,
          },
        },
      });

      return created;
    });

    return group;
  }

  async listGroups(orgId: string) {
    const groups = await this.prisma.workerGroup.findMany({
      where: { organizationId: orgId },
      include: {
        _count: {
          select: {
            members: {
              where: { leftAt: null },
            },
          },
        },
      },
      orderBy: { code: 'asc' },
    });

    return groups.map((g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      description: g.description,
      status: g.status,
      activeMembersCount: g._count.members,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    }));
  }

  async getGroupById(orgId: string, groupId: string) {
    const group = await this.prisma.workerGroup.findFirst({
      where: {
        id: groupId,
        organizationId: orgId,
      },
      include: {
        _count: {
          select: {
            members: { where: { leftAt: null } },
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException(`Worker group '${groupId}' not found`);
    }

    return {
      id: group.id,
      code: group.code,
      name: group.name,
      description: group.description,
      status: group.status,
      activeMembersCount: group._count.members,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  async updateGroup(
    orgId: string,
    groupId: string,
    input: UpdateWorkerGroupInput,
    actorUserId: string | null,
  ) {
    const existing = await this.prisma.workerGroup.findFirst({
      where: { id: groupId, organizationId: orgId },
    });

    if (!existing) {
      throw new NotFoundException(`Worker group '${groupId}' not found`);
    }

    if (input.code && input.code !== existing.code) {
      const codeConflict = await this.prisma.workerGroup.findUnique({
        where: {
          organizationId_code: {
            organizationId: orgId,
            code: input.code,
          },
        },
      });

      if (codeConflict) {
        throw new ConflictException(`Worker group code '${input.code}' already exists in this organization`);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const grp = await tx.workerGroup.update({
        where: { id: groupId },
        data: {
          ...(input.code && { code: input.code }),
          ...(input.name && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.status && { status: input.status }),
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId,
          action: 'WORKER_GROUP_UPDATED',
          targetType: 'WorkerGroup',
          targetId: grp.id,
          metadata: { changes: input },
        },
      });

      return grp;
    });

    return updated;
  }

  async addMembers(
    orgId: string,
    groupId: string,
    input: ManageWorkerGroupMembersInput,
    actorUserId: string | null,
  ) {
    const group = await this.prisma.workerGroup.findFirst({
      where: { id: groupId, organizationId: orgId },
    });

    if (!group) {
      throw new NotFoundException(`Worker group '${groupId}' not found`);
    }

    const now = new Date();

    const addedMemberIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const empId of input.employeeIds) {
        const employee = await tx.employee.findFirst({
          where: { id: empId, organizationId: orgId },
        });

        if (!employee) {
          throw new NotFoundException(`Employee '${empId}' not found in organization`);
        }

        const activeMembership = await tx.workerGroupMember.findFirst({
          where: {
            organizationId: orgId,
            workerGroupId: groupId,
            employeeId: empId,
            leftAt: null,
          },
        });

        if (!activeMembership) {
          const newMem = await tx.workerGroupMember.create({
            data: {
              organizationId: orgId,
              workerGroupId: groupId,
              employeeId: empId,
              joinedAt: now,
              leftAt: null,
            },
          });
          addedMemberIds.push(newMem.id);
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId,
          action: 'WORKER_GROUP_MEMBERS_ADDED',
          targetType: 'WorkerGroup',
          targetId: groupId,
          metadata: {
            addedCount: addedMemberIds.length,
            employeeIds: input.employeeIds,
          },
        },
      });
    });

    return { addedCount: addedMemberIds.length };
  }

  async removeMembers(
    orgId: string,
    groupId: string,
    input: ManageWorkerGroupMembersInput,
    actorUserId: string | null,
  ) {
    const group = await this.prisma.workerGroup.findFirst({
      where: { id: groupId, organizationId: orgId },
    });

    if (!group) {
      throw new NotFoundException(`Worker group '${groupId}' not found`);
    }

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const updateRes = await tx.workerGroupMember.updateMany({
        where: {
          organizationId: orgId,
          workerGroupId: groupId,
          employeeId: { in: input.employeeIds },
          leftAt: null,
        },
        data: {
          leftAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId,
          action: 'WORKER_GROUP_MEMBERS_REMOVED',
          targetType: 'WorkerGroup',
          targetId: groupId,
          metadata: {
            removedCount: updateRes.count,
            employeeIds: input.employeeIds,
          },
        },
      });

      return updateRes;
    });

    return { removedCount: result.count };
  }

  async listGroupMembers(orgId: string, groupId: string) {
    const group = await this.prisma.workerGroup.findFirst({
      where: { id: groupId, organizationId: orgId },
    });

    if (!group) {
      throw new NotFoundException(`Worker group '${groupId}' not found`);
    }

    const members = await this.prisma.workerGroupMember.findMany({
      where: {
        organizationId: orgId,
        workerGroupId: groupId,
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return members.map((m) => ({
      id: m.id,
      workerGroupId: m.workerGroupId,
      employeeId: m.employeeId,
      employeeCode: m.employee.employeeCode,
      employeeName: m.employee.fullName,
      joinedAt: m.joinedAt.toISOString(),
      leftAt: m.leftAt?.toISOString() ?? null,
    }));
  }
}
