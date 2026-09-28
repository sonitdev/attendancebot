import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePositionRequestInput,
  ResolvePositionRequestInput,
} from '@workforce/contracts';
import { PositionHistorySource, PositionRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PositionRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async createRequest(
    orgId: string,
    employeeId: string,
    input: CreatePositionRequestInput,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationId: orgId,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee '${employeeId}' not found in organization`);
    }

    const position = await this.prisma.position.findFirst({
      where: {
        id: input.requestedPositionId,
        organizationId: orgId,
      },
    });

    if (!position) {
      throw new NotFoundException(`Position '${input.requestedPositionId}' not found`);
    }

    if (position.status !== 'ACTIVE') {
      throw new BadRequestException(`Position '${position.name}' is inactive and cannot be requested`);
    }

    const pendingRequest = await this.prisma.positionRequest.findFirst({
      where: {
        organizationId: orgId,
        employeeId: employeeId,
        status: PositionRequestStatus.PENDING,
      },
    });

    if (pendingRequest) {
      throw new ConflictException('A pending position request already exists for this worker');
    }

    const request = await this.prisma.positionRequest.create({
      data: {
        organizationId: orgId,
        employeeId: employeeId,
        requestedPositionId: input.requestedPositionId,
        status: PositionRequestStatus.PENDING,
        requestedAt: new Date(),
      },
      include: {
        requestedPosition: true,
      },
    });

    return request;
  }

  async listRequests(orgId: string, statusFilter?: PositionRequestStatus) {
    return this.prisma.positionRequest.findMany({
      where: {
        organizationId: orgId,
        ...(statusFilter && { status: statusFilter }),
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        requestedPosition: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async getEmployeePendingRequest(orgId: string, employeeId: string) {
    return this.prisma.positionRequest.findFirst({
      where: {
        organizationId: orgId,
        employeeId: employeeId,
        status: PositionRequestStatus.PENDING,
      },
      include: {
        requestedPosition: true,
      },
    });
  }

  async resolveRequest(
    orgId: string,
    requestId: string,
    input: ResolvePositionRequestInput,
    managerUserId: string,
  ) {
    const request = await this.prisma.positionRequest.findFirst({
      where: {
        id: requestId,
        organizationId: orgId,
      },
      include: {
        employee: true,
        requestedPosition: true,
      },
    });

    if (!request) {
      throw new NotFoundException(`Position request '${requestId}' not found`);
    }

    if (request.status !== PositionRequestStatus.PENDING) {
      throw new BadRequestException(`Position request is already resolved (${request.status})`);
    }

    const reviewedAt = new Date();

    if (input.approved) {
      // Transactional approval: close active history, append new history, update cache, update request status, audit log
      const result = await this.prisma.$transaction(async (tx) => {
        const currentOpenHistory = await tx.employeePositionHistory.findFirst({
          where: {
            organizationId: orgId,
            employeeId: request.employeeId,
            effectiveTo: null,
          },
        });

        if (currentOpenHistory) {
          await tx.employeePositionHistory.update({
            where: { id: currentOpenHistory.id },
            data: { effectiveTo: reviewedAt },
          });
        }

        const newHistory = await tx.employeePositionHistory.create({
          data: {
            organizationId: orgId,
            employeeId: request.employeeId,
            positionId: request.requestedPositionId,
            effectiveFrom: reviewedAt,
            effectiveTo: null,
            source: PositionHistorySource.WORKER_REQUEST_APPROVED,
            assignedByUserId: managerUserId,
          },
        });

        await tx.employee.update({
          where: { id: request.employeeId },
          data: { currentPositionId: request.requestedPositionId },
        });

        const updatedRequest = await tx.positionRequest.update({
          where: { id: requestId },
          data: {
            status: PositionRequestStatus.APPROVED,
            reviewedAt,
            reviewedByUserId: managerUserId,
            reviewNote: input.reviewNote ?? null,
          },
          include: {
            employee: true,
            requestedPosition: true,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: managerUserId,
            action: 'POSITION_REQUEST_APPROVED',
            targetType: 'PositionRequest',
            targetId: requestId,
            metadata: {
              employeeId: request.employeeId,
              requestedPositionId: request.requestedPositionId,
              historyRecordId: newHistory.id,
              reviewNote: input.reviewNote ?? null,
            },
          },
        });

        return updatedRequest;
      });

      return result;
    } else {
      // Manager rejection: update status to REJECTED, preserve record, log audit
      const updatedRequest = await this.prisma.$transaction(async (tx) => {
        const rejected = await tx.positionRequest.update({
          where: { id: requestId },
          data: {
            status: PositionRequestStatus.REJECTED,
            reviewedAt,
            reviewedByUserId: managerUserId,
            reviewNote: input.reviewNote ?? null,
          },
          include: {
            employee: true,
            requestedPosition: true,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: managerUserId,
            action: 'POSITION_REQUEST_REJECTED',
            targetType: 'PositionRequest',
            targetId: requestId,
            metadata: {
              employeeId: request.employeeId,
              requestedPositionId: request.requestedPositionId,
              reviewNote: input.reviewNote ?? null,
            },
          },
        });

        return rejected;
      });

      return updatedRequest;
    }
  }
}
