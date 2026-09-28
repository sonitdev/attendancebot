import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AssignPositionInput,
  CreatePositionInput,
  UpdatePositionInput,
} from '@workforce/contracts';
import { PositionHistorySource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPosition(orgId: string, input: CreatePositionInput, actorUserId: string | null) {
    const existing = await this.prisma.position.findUnique({
      where: {
        organizationId_code: {
          organizationId: orgId,
          code: input.code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Position code '${input.code}' already exists in this organization`);
    }

    const position = await this.prisma.$transaction(async (tx) => {
      const created = await tx.position.create({
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
          actorUserId: actorUserId,
          action: 'POSITION_CREATED',
          targetType: 'Position',
          targetId: created.id,
          metadata: {
            code: created.code,
            name: created.name,
          },
        },
      });

      return created;
    });

    return position;
  }

  async listPositions(orgId: string) {
    return this.prisma.position.findMany({
      where: { organizationId: orgId },
      orderBy: { code: 'asc' },
    });
  }

  async getPositionById(orgId: string, positionId: string) {
    const position = await this.prisma.position.findFirst({
      where: {
        id: positionId,
        organizationId: orgId,
      },
    });

    if (!position) {
      throw new NotFoundException(`Position '${positionId}' not found`);
    }

    return position;
  }

  async updatePosition(
    orgId: string,
    positionId: string,
    input: UpdatePositionInput,
    actorUserId: string | null,
  ) {
    const existing = await this.getPositionById(orgId, positionId);

    if (input.code && input.code !== existing.code) {
      const codeConflict = await this.prisma.position.findUnique({
        where: {
          organizationId_code: {
            organizationId: orgId,
            code: input.code,
          },
        },
      });

      if (codeConflict) {
        throw new ConflictException(`Position code '${input.code}' already exists in this organization`);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const pos = await tx.position.update({
        where: { id: positionId },
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
          actorUserId: actorUserId,
          action: 'POSITION_UPDATED',
          targetType: 'Position',
          targetId: pos.id,
          metadata: {
            changes: input,
          },
        },
      });

      return pos;
    });

    return updated;
  }

  async assignEmployeePosition(
    orgId: string,
    employeeId: string,
    input: AssignPositionInput,
    actorUserId: string | null,
  ) {
    // 1. Verify employee belongs to tenant
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationId: orgId,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee '${employeeId}' not found in organization`);
    }

    // 2. Verify position belongs to tenant and is ACTIVE
    const position = await this.prisma.position.findFirst({
      where: {
        id: input.positionId,
        organizationId: orgId,
      },
    });

    if (!position) {
      throw new NotFoundException(`Position '${input.positionId}' not found in organization`);
    }

    if (position.status !== 'ACTIVE') {
      throw new BadRequestException(`Position '${position.name}' is inactive and cannot be assigned`);
    }

    const effectiveFromDate = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();

    // 3. Transactional update: close active history interval, create new history, update currentPositionId cache, write audit log
    const result = await this.prisma.$transaction(async (tx) => {
      // Find current open history record for worker
      const currentOpenHistory = await tx.employeePositionHistory.findFirst({
        where: {
          organizationId: orgId,
          employeeId: employeeId,
          effectiveTo: null,
        },
      });

      if (currentOpenHistory) {
        // Close current active history interval
        await tx.employeePositionHistory.update({
          where: { id: currentOpenHistory.id },
          data: { effectiveTo: effectiveFromDate },
        });
      }

      // Create new append-only position history record
      const newHistory = await tx.employeePositionHistory.create({
        data: {
          organizationId: orgId,
          employeeId: employeeId,
          positionId: input.positionId,
          effectiveFrom: effectiveFromDate,
          effectiveTo: null,
          source: PositionHistorySource.MANAGER_ASSIGNED,
          assignedByUserId: actorUserId,
        },
      });

      // Update read-model cache on Employee record
      const updatedEmployee = await tx.employee.update({
        where: { id: employeeId },
        data: { currentPositionId: input.positionId },
        include: {
          currentPosition: true,
        },
      });

      // Append Audit Log
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: actorUserId,
          action: 'EMPLOYEE_POSITION_ASSIGNED',
          targetType: 'Employee',
          targetId: employeeId,
          metadata: {
            previousPositionId: currentOpenHistory?.positionId ?? null,
            newPositionId: input.positionId,
            historyRecordId: newHistory.id,
            effectiveFrom: effectiveFromDate.toISOString(),
          },
        },
      });

      return {
        employee: updatedEmployee,
        historyRecord: newHistory,
      };
    });

    return result;
  }

  async getEmployeePositionHistory(orgId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationId: orgId,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee '${employeeId}' not found in organization`);
    }

    return this.prisma.employeePositionHistory.findMany({
      where: {
        organizationId: orgId,
        employeeId: employeeId,
      },
      include: {
        position: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}
