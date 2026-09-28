import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RegistrationRequestStatus } from '@prisma/client';
import type { ResolveRegistrationRequestInput } from '@workforce/contracts';
import { TelegramNotifierService } from '../jobs/telegram-notifier.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RegistrationRequestsService {
  private readonly logger = new Logger(RegistrationRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramNotifier: TelegramNotifierService,
  ) {}

  async listRequests(orgId: string, statusFilter?: RegistrationRequestStatus) {
    const requests = await this.prisma.registrationRequest.findMany({
      where: {
        organizationId: orgId,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: {
        requestedAt: 'desc',
      },
    });

    return requests.map((r) => ({
      id: r.id,
      telegramUserId: r.telegramUserId,
      phone: r.phone,
      normalizedPhone: r.normalizedPhone,
      telegramUsername: r.telegramUsername,
      telegramFirstName: r.telegramFirstName,
      telegramLastName: r.telegramLastName,
      telegramPhotoUrl: r.telegramPhotoUrl,
      status: r.status,
      reviewNote: r.reviewNote,
      createdEmployeeId: r.createdEmployeeId,
      createdAt: r.requestedAt.toISOString(),
      updatedAt: (r.reviewedAt || r.requestedAt).toISOString(),
    }));
  }

  async resolveRequest(
    orgId: string,
    requestId: string,
    input: ResolveRegistrationRequestInput,
    reviewerUserId: string,
  ) {
    const request = await this.prisma.registrationRequest.findFirst({
      where: { id: requestId, organizationId: orgId },
    });

    if (!request) {
      throw new NotFoundException('Registration request not found');
    }

    if (request.status !== RegistrationRequestStatus.PENDING) {
      throw new BadRequestException('REGISTRATION_REQUEST_ALREADY_RESOLVED');
    }

    if (input.approved) {
      const fullName = (
        input.fullName ||
        [request.telegramFirstName, request.telegramLastName].filter(Boolean).join(' ') ||
        'Worker'
      ).trim();

      const employeeCode = (
        input.employeeCode ||
        `EMP-${Math.floor(100000 + Math.random() * 900000)}`
      ).trim();

      // Check if employee code is already taken in this org
      const existingCode = await this.prisma.employee.findUnique({
        where: {
          organizationId_employeeCode: {
            organizationId: orgId,
            employeeCode,
          },
        },
      });

      if (existingCode) {
        throw new BadRequestException(`Employee code ${employeeCode} already exists in this organization.`);
      }

      // Perform transactional creation of Employee, TelegramAccount, AuditLog, and approval
      const result = await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: {
            organizationId: orgId,
            employeeCode,
            fullName,
            phone: request.phone,
            normalizedPhone: request.normalizedPhone,
            avatarUrl: request.telegramPhotoUrl,
            currentPositionId: input.positionId || null,
            status: 'ACTIVE',
          },
        });

        await tx.telegramAccount.create({
          data: {
            organizationId: orgId,
            employeeId: employee.id,
            telegramUserId: request.telegramUserId,
            username: request.telegramUsername,
            firstName: request.telegramFirstName,
            lastName: request.telegramLastName,
            photoUrl: request.telegramPhotoUrl,
            status: 'ACTIVE',
          },
        });

        if (input.positionId) {
          await tx.employeePositionHistory.create({
            data: {
              organizationId: orgId,
              employeeId: employee.id,
              positionId: input.positionId,
              source: 'MANAGER_ASSIGNED',
              assignedByUserId: reviewerUserId,
            },
          });
        }

        const updatedRequest = await tx.registrationRequest.update({
          where: { id: requestId },
          data: {
            status: RegistrationRequestStatus.APPROVED,
            reviewedAt: new Date(),
            reviewedByUserId: reviewerUserId,
            reviewNote: input.reviewNote || null,
            createdEmployeeId: employee.id,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: reviewerUserId,
            action: 'REGISTRATION_REQUEST_APPROVED',
            targetType: 'RegistrationRequest',
            targetId: requestId,
            metadata: {
              employeeId: employee.id,
              employeeCode: employee.employeeCode,
              telegramUserId: request.telegramUserId,
              reviewNote: input.reviewNote || null,
            },
          },
        });

        return { employee, updatedRequest };
      });

      // Send Telegram notification
      void this.telegramNotifier.sendMessage(
        request.telegramUserId,
        `🎉 *Registration Approved!*\n\nWelcome to the team, *${result.employee.fullName}*!\n• *Employee Code:* \`${result.employee.employeeCode}\`\n\nYour worker account has been authorized. You can now tap *📍 Check In* in the bot or open the Mini App!`,
        'Markdown',
      );

      return {
        id: result.updatedRequest.id,
        status: result.updatedRequest.status,
        createdEmployeeId: result.employee.id,
        employeeCode: result.employee.employeeCode,
        fullName: result.employee.fullName,
      };
    } else {
      // Rejection branch
      const updatedRequest = await this.prisma.$transaction(async (tx) => {
        const req = await tx.registrationRequest.update({
          where: { id: requestId },
          data: {
            status: RegistrationRequestStatus.REJECTED,
            reviewedAt: new Date(),
            reviewedByUserId: reviewerUserId,
            reviewNote: input.reviewNote || null,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: reviewerUserId,
            action: 'REGISTRATION_REQUEST_REJECTED',
            targetType: 'RegistrationRequest',
            targetId: requestId,
            metadata: {
              telegramUserId: request.telegramUserId,
              reviewNote: input.reviewNote || null,
            },
          },
        });

        return req;
      });

      // Notify Telegram user of rejection
      void this.telegramNotifier.sendMessage(
        request.telegramUserId,
        `⚠️ *Registration Request Update*\n\nYour registration request was reviewed and declined by a manager.\n${
          input.reviewNote ? `*Reason:* ${input.reviewNote}` : ''
        }\n\nPlease contact your supervisor if you believe this was in error.`,
        'Markdown',
      );

      return {
        id: updatedRequest.id,
        status: updatedRequest.status,
        createdEmployeeId: null,
      };
    }
  }
}
