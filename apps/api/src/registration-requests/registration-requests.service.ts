import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RegistrationRequestStatus } from '@prisma/client';
import type { ResolveRegistrationRequestInput } from '@workforce/contracts';
import { km } from '@workforce/contracts';
import { TelegramNotifierService } from '../jobs/telegram-notifier.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAuthorizationService } from '../auth/project-authorization.service.js';

@Injectable()
export class RegistrationRequestsService {
  private readonly logger = new Logger(RegistrationRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramNotifier: TelegramNotifierService,
    private readonly projectAuthorization: ProjectAuthorizationService,
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
        // Telegram may deliver the same callback to more than one API
        // instance. Serialize approval by request ID across processes and
        // re-check the state after acquiring the database lock.
        if (typeof tx.$executeRaw === 'function') {
          // pg_advisory_xact_lock returns PostgreSQL `void`; use executeRaw
          // so Prisma does not try to deserialize that result as a column.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        }
        const lockedRequest = await tx.registrationRequest.findFirst({
          where: { id: requestId, organizationId: orgId },
          select: { status: true },
        });
        if (lockedRequest?.status !== RegistrationRequestStatus.PENDING) {
          throw new BadRequestException('REGISTRATION_REQUEST_ALREADY_RESOLVED');
        }

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

        const pendingProject = await tx.pendingTelegramProjectSelection.findFirst({
          where: { organizationId: orgId, telegramUserId: request.telegramUserId },
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
              pendingProjectId: pendingProject?.organizationId === orgId ? pendingProject.projectId : null,
              reviewNote: input.reviewNote || null,
            },
          },
        });

        return { employee, updatedRequest };
      });

      const pendingProject = await this.prisma.pendingTelegramProjectSelection.findFirst({
        where: { organizationId: orgId, telegramUserId: request.telegramUserId },
      });
      if (pendingProject?.organizationId === orgId) {
        try {
          await this.projectAuthorization.authorizeWorkerProject(
            {
              type: 'worker',
              organizationId: orgId,
              employeeId: result.employee.id,
              telegramUserId: request.telegramUserId,
              sessionId: 'registration-approval',
            },
            pendingProject.projectId,
            'REGISTRATION',
            false,
          );
          await this.prisma.$transaction(async (tx) => {
            await tx.workerProject.upsert({
              where: { employeeId_projectId: { employeeId: result.employee.id, projectId: pendingProject.projectId } },
              create: { organizationId: orgId, employeeId: result.employee.id, projectId: pendingProject.projectId, lastSelectedAt: new Date(), lastVerifiedAt: new Date(), authorizationStatus: 'AUTHORIZED', lastVerificationResult: 'MEMBERSHIP_VERIFIED' },
              update: { lastSelectedAt: new Date(), lastVerifiedAt: new Date(), authorizationStatus: 'AUTHORIZED', revokedAt: null, lastVerificationResult: 'MEMBERSHIP_VERIFIED' },
            });
            await tx.employee.update({ where: { id: result.employee.id }, data: { currentProjectId: pendingProject.projectId } });
            await tx.pendingTelegramProjectSelection.delete({ where: { id: pendingProject.id } });
          });
          await this.projectAuthorization.ensureProjectSiteAndAssignment(
            orgId,
            pendingProject.projectId,
            result.employee.id,
          );
        } catch {
          await this.prisma.pendingTelegramProjectSelection.delete({ where: { id: pendingProject.id } });
        }
      }

      // Notify the worker after the approval transaction has committed. Await
      // delivery so Telegram failures are visible and retryable instead of
      // being silently discarded by a fire-and-forget promise.
      try {
        const miniAppUrl = process.env.TELEGRAM_MINI_APP_URL?.replace(/\/$/, '');
        await this.telegramNotifier.sendMessage(
          request.telegramUserId,
          km.telegram.registrationSuccess(
            result.employee.fullName,
            result.employee.employeeCode,
            (await this.prisma.organization.findUnique({ where: { id: orgId } }))?.name ?? '',
          ),
          'Markdown',
          miniAppUrl
            ? { inline_keyboard: [[{ text: km.telegram.openAttendance, web_app: { url: miniAppUrl } }]] }
            : undefined,
        );
      } catch (error: any) {
        this.logger.error(`Registration approved but worker notification failed for ${request.telegramUserId}: ${error?.message || error}`);
      }

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
      const workerName = [request.telegramFirstName, request.telegramLastName].filter(Boolean).join(' ') || '';
      void this.telegramNotifier.sendMessage(
        request.telegramUserId,
        `⚠️ សំណើចុះឈ្មោះរបស់អ្នកត្រូវបានពិនិត្យ និងបដិសេធ។${input.reviewNote ? `\nមូលហេតុ៖ ${input.reviewNote}` : ''}\n\nសូមទាក់ទងអ្នកគ្រប់គ្រង ប្រសិនបើអ្នកគិតថានេះជាកំហុស។`,
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
