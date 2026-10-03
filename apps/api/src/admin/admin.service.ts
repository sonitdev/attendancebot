import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type {
  CreateAssignmentInput,
  CreateEmployeeInput,
  CreateProjectInput,
  CreateSiteInput,
  CreateWorkScheduleInput,
  LinkTelegramInput,
  UpdateAssignmentInput,
  UpdateEmployeeInput,
  UpdateProjectInput,
  UpdateSiteInput,
  UpdateWorkScheduleInput,
  UpdateTelegramReportGroupInput,
  UpdateOrganizationSettingsInput,
  ReplaceAdminScopesInput,
} from '@workforce/contracts';
import { maskPhone, normalizePhone } from '../common/phone.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramNotifierService } from '../jobs/telegram-notifier.service.js';
import { km } from '@workforce/contracts';
import type { AdminDataScope } from '../auth/admin-scope.service.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramNotifier: TelegramNotifierService,
    private readonly configService: ConfigService,
  ) {}

  async createTelegramOwnerPairing(organizationId: string, userId: string) {
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('ORGANIZATION_NOT_FOUND');
    const setupCode = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.prisma.telegramOrganizationOwner.upsert({
      where: { organizationId },
      create: { organizationId, userId, setupCode, setupCodeExpiresAt: expiresAt },
      update: { userId, setupCode, setupCodeExpiresAt: expiresAt, setupCodeUsedAt: null, telegramUserId: null, telegramUsername: null, pairedAt: null },
    });
    const username = this.configService.get<string>('TELEGRAM_BOT_USERNAME') ?? 'site_attendantbot';
    return { url: `https://t.me/${username}?start=owner_${setupCode}`, expiresAt: expiresAt.toISOString() };
  }

  async getOrganizationSettings(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('ORGANIZATION_NOT_FOUND');
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logoUrl: organization.logoUrl,
      brandPrimaryColor: organization.brandPrimaryColor,
      brandAccentColor: organization.brandAccentColor,
      defaultLocale: organization.defaultLocale,
    };
  }

  async listAdminAccessScopes(organizationId: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: {
        id: true,
        email: true,
        roles: { select: { role: { select: { code: true, name: true } } } },
        projectScopes: { select: { project: { select: { id: true, code: true, name: true } } } },
        siteScopes: { select: { site: { select: { id: true, name: true, projectId: true } } } },
      },
      orderBy: { email: 'asc' },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      roles: user.roles.map((item) => item.role),
      projects: user.projectScopes.map((item) => item.project),
      sites: user.siteScopes.map((item) => item.site),
    }));
  }

  async replaceAdminAccessScopes(organizationId: string, userId: string, input: ReplaceAdminScopesInput, actorUserId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE' } });
    if (!user) throw new NotFoundException('ADMIN_USER_NOT_FOUND');
    const [projects, sites] = await Promise.all([
      this.prisma.project.findMany({ where: { organizationId, id: { in: input.projectIds } }, select: { id: true } }),
      this.prisma.site.findMany({ where: { organizationId, id: { in: input.siteIds } }, select: { id: true } }),
    ]);
    if (projects.length !== new Set(input.projectIds).size) throw new BadRequestException('INVALID_PROJECT_SCOPE');
    if (sites.length !== new Set(input.siteIds).size) throw new BadRequestException('INVALID_SITE_SCOPE');

    await this.prisma.$transaction(async (tx) => {
      await tx.userProjectScope.deleteMany({ where: { organizationId, userId } });
      await tx.userSiteScope.deleteMany({ where: { organizationId, userId } });
      if (projects.length) {
        await tx.userProjectScope.createMany({ data: projects.map((project) => ({ organizationId, userId, projectId: project.id })) });
      }
      if (sites.length) {
        await tx.userSiteScope.createMany({ data: sites.map((site) => ({ organizationId, userId, siteId: site.id })) });
      }
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: 'ADMIN_ACCESS_SCOPES_REPLACED',
          targetType: 'User',
          targetId: userId,
          metadata: { projectIds: input.projectIds, siteIds: input.siteIds },
        },
      });
    });
    return { userId, projectIds: input.projectIds, siteIds: input.siteIds };
  }

  async updateOrganizationSettings(organizationId: string, input: UpdateOrganizationSettingsInput, actorUserId: string) {
    const before = await this.getOrganizationSettings(organizationId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.update({ where: { id: organizationId }, data: input });
      await tx.auditLog.create({ data: { organizationId, actorUserId, action: 'ORGANIZATION_SETTINGS_UPDATED', targetType: 'Organization', targetId: organizationId, metadata: { before, after: input } } });
      return organization;
    });
    return { id: updated.id, name: updated.name, slug: updated.slug, logoUrl: updated.logoUrl, brandPrimaryColor: updated.brandPrimaryColor, brandAccentColor: updated.brandAccentColor, defaultLocale: updated.defaultLocale };
  }

  async uploadOrganizationLogo(organizationId: string, imageDataUrl: string, actorUserId: string) {
    const baseUrl = this.configService.get<string>('SUPABASE_URL') ?? process.env.SUPABASE_URL;
    const serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) throw new BadRequestException('LOGO_STORAGE_NOT_CONFIGURED');
    const [header, encoded] = imageDataUrl.split(',', 2);
    const mime = header.includes('svg') ? 'image/svg+xml' : header.includes('webp') ? 'image/webp' : header.includes('png') ? 'image/png' : 'image/jpeg';
    const extension = mime === 'image/svg+xml' ? 'svg' : mime.split('/')[1];
    const path = `${organizationId}/portal-logo.${extension}`;
    const response = await fetch(`${baseUrl}/storage/v1/object/company-branding/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': mime, 'x-upsert': 'true' }, body: Buffer.from(encoded ?? '', 'base64') });
    if (!response.ok) throw new BadRequestException('LOGO_UPLOAD_FAILED');
    const logoUrl = `${baseUrl}/storage/v1/object/public/company-branding/${path}`;
    await this.updateOrganizationSettings(organizationId, { logoUrl }, actorUserId);
    return { logoUrl };
  }

  async refreshProjectTelegramHealth(organizationId: string, projectId: string, actorUserId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('PROJECT_NOT_FOUND');
    if (!project.telegramChatId) throw new BadRequestException('PROJECT_TELEGRAM_NOT_CONNECTED');
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new BadRequestException('TELEGRAM_NOT_CONFIGURED');
    let connectionStatus = 'PERMISSION_ERROR';
    let healthError: string | null = null;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(project.telegramChatId)}`);
      const payload = await response.json() as { ok?: boolean; description?: string };
      if (payload.ok) connectionStatus = 'CONNECTED';
      else {
        healthError = payload.description ?? `HTTP_${response.status}`;
        connectionStatus = /kicked|chat not found|not a member/i.test(healthError) ? 'BOT_REMOVED' : 'PERMISSION_ERROR';
      }
    } catch (reason) {
      healthError = reason instanceof Error ? reason.message : 'TELEGRAM_HEALTH_CHECK_FAILED';
    }
    const checkedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.project.update({ where: { id: project.id }, data: { telegramConnectionStatus: connectionStatus, telegramHealthCheckedAt: checkedAt, telegramHealthError: healthError } });
      await tx.auditLog.create({ data: { organizationId, actorUserId, action: 'TELEGRAM_CONNECTION_HEALTH_CHECKED', targetType: 'Project', targetId: project.id, metadata: { connectionStatus, healthError } } });
      return saved;
    });
    return { projectId: updated.id, connectionStatus: updated.telegramConnectionStatus, checkedAt: updated.telegramHealthCheckedAt?.toISOString() ?? null, error: updated.telegramHealthError };
  }

  async listTelegramReportGroups(organizationId: string, scope?: AdminDataScope) {
    const records = await this.prisma.telegramReportGroup.findMany({ where: { organizationId, ...(!scope || scope.unrestricted ? {} : { OR: [{ site: { projectId: { in: scope.projectIds } } }, { siteId: { in: scope.siteIds } }] }) }, include: { site: { select: { name: true } }, workerGroup: { select: { name: true } } }, orderBy: { connectedAt: 'desc' } });
    return records.map((r) => ({ id: r.id, title: r.title, status: r.status, connectedAt: r.connectedAt.toISOString(), targetType: r.siteId ? 'SITE' : r.workerGroupId ? 'WORKER_GROUP' : null, targetId: r.siteId ?? r.workerGroupId, targetName: r.site?.name ?? r.workerGroup?.name ?? null }));
  }

  async updateTelegramReportGroup(organizationId: string, id: string, input: UpdateTelegramReportGroupInput, actorUserId: string) {
    const record = await this.prisma.telegramReportGroup.findFirst({ where: { id, organizationId } });
    if (!record) throw new NotFoundException('TELEGRAM_REPORT_GROUP_NOT_FOUND');
    let siteId: string | null = null; let workerGroupId: string | null = null;
    let canonicalProject: { id: string; telegramChatId: string | null } | null = null;
    if (input.targetType === 'SITE') {
      const site = await this.prisma.site.findFirst({
        where: { id: input.targetId, organizationId, status: 'ACTIVE', project: { status: 'ACTIVE' } },
        include: { project: { select: { id: true, telegramChatId: true } } },
      });
      if (!site) throw new NotFoundException('SITE_NOT_FOUND_OR_INACTIVE');
      siteId = site.id;
      canonicalProject = site.project;
      if (canonicalProject.telegramChatId && canonicalProject.telegramChatId !== record.chatId) {
        throw new BadRequestException('PROJECT_ALREADY_CONNECTED_TO_ANOTHER_TELEGRAM_GROUP');
      }
    }
    if (input.targetType === 'WORKER_GROUP') { const group = await this.prisma.workerGroup.findFirst({ where: { id: input.targetId, organizationId, status: 'ACTIVE' } }); if (!group) throw new NotFoundException('WORKER_GROUP_NOT_FOUND_OR_INACTIVE'); workerGroupId = group.id; }
    const result = await this.prisma.$transaction(async (tx) => {
      if (canonicalProject) {
        const generatedProject = await tx.project.findFirst({
          where: { organizationId, telegramChatId: record.chatId },
          include: { _count: { select: { attendanceRecords: true, sites: true } } },
        });

        if (generatedProject && generatedProject.id !== canonicalProject.id) {
          if (generatedProject._count.attendanceRecords > 0 || generatedProject._count.sites > 0) {
            throw new BadRequestException('TELEGRAM_PROJECT_REQUIRES_MANUAL_MERGE');
          }

          const generatedConnections = await tx.workerProject.findMany({
            where: { organizationId, projectId: generatedProject.id },
          });
          for (const connection of generatedConnections) {
            await tx.workerProject.upsert({
              where: { employeeId_projectId: { employeeId: connection.employeeId, projectId: canonicalProject.id } },
              create: {
                organizationId,
                employeeId: connection.employeeId,
                projectId: canonicalProject.id,
                connectedAt: connection.connectedAt,
                lastSelectedAt: connection.lastSelectedAt,
                authorizationStatus: connection.authorizationStatus,
                lastVerifiedAt: connection.lastVerifiedAt,
                revokedAt: connection.revokedAt,
                lastVerificationResult: connection.lastVerificationResult,
              },
              update: {
                lastSelectedAt: connection.lastSelectedAt,
                authorizationStatus: connection.authorizationStatus,
                lastVerifiedAt: connection.lastVerifiedAt,
                revokedAt: connection.revokedAt,
                lastVerificationResult: connection.lastVerificationResult,
              },
            });
          }
          await tx.workerProject.deleteMany({ where: { organizationId, projectId: generatedProject.id } });
          await tx.employee.updateMany({
            where: { organizationId, currentProjectId: generatedProject.id },
            data: { currentProjectId: canonicalProject.id },
          });
          await tx.project.update({
            where: { id: generatedProject.id },
            data: {
              telegramChatId: null,
              telegramConnectionStatus: 'MIGRATED',
              telegramHealthError: null,
              status: 'ARCHIVED',
            },
          });
        }

        await tx.project.update({
          where: { id: canonicalProject.id },
          data: {
            telegramChatId: record.chatId,
            telegramConnectionStatus: 'CONNECTED',
            telegramConnectedAt: new Date(),
            telegramHealthError: null,
          },
        });
      }

      const updated = await tx.telegramReportGroup.update({ where: { id }, data: { siteId, workerGroupId, status: input.enabled ? 'ACTIVE' : 'INACTIVE' } });
      await tx.auditLog.create({ data: { organizationId, actorUserId, action: 'TELEGRAM_REPORT_GROUP_CONFIGURED', targetType: 'TelegramReportGroup', targetId: id, metadata: { targetType: input.targetType, targetId: input.targetId ?? null, projectId: canonicalProject?.id ?? null, enabled: input.enabled } } });
      return { id: updated.id, status: updated.status };
    });
    if (input.enabled && canonicalProject) {
      await this.telegramNotifier.sendMessage(record.chatId, km.telegram.projectConnected, 'Markdown', {
        inline_keyboard: [[{ text: km.telegram.setCurrentProject, callback_data: 'set_current_project' }]],
      });
    }
    return result;
  }

  async createEmployee(organizationId: string, input: CreateEmployeeInput) {
    const existing = await this.prisma.employee.findUnique({
      where: {
        organizationId_employeeCode: {
          organizationId,
          employeeCode: input.employeeCode,
        },
      },
    });

    if (existing) {
      throw new ConflictException('EMPLOYEE_CODE_EXISTS');
    }

    const normalizedPhone = normalizePhone(input.phone);
    if (normalizedPhone) {
      const existingPhone = await this.prisma.employee.findUnique({
        where: {
          organizationId_normalizedPhone: {
            organizationId,
            normalizedPhone,
          },
        },
      });

      if (existingPhone) {
        throw new ConflictException('PHONE_NUMBER_EXISTS');
      }
    }

    return this.prisma.employee.create({
      data: {
        organizationId,
        employeeCode: input.employeeCode,
        fullName: input.fullName,
        phone: input.phone,
        normalizedPhone,
        jobTitle: input.jobTitle,
        status: 'ACTIVE',
      },
    });
  }

  async createProject(organizationId: string, input: CreateProjectInput) {
    const existing = await this.prisma.project.findUnique({
      where: {
        organizationId_code: {
          organizationId,
          code: input.code,
        },
      },
    });

    if (existing) {
      throw new ConflictException('PROJECT_CODE_EXISTS');
    }

    return this.prisma.project.create({
      data: {
        organizationId,
        code: input.code,
        name: input.name,
        workMode: input.workMode,
        status: 'ACTIVE',
      },
    });
  }

  async updateProject(organizationId: string, id: string, input: UpdateProjectInput) {
    const existing = await this.prisma.project.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException('PROJECT_NOT_FOUND');
    }

    if (input.code && input.code !== existing.code) {
      const codeCheck = await this.prisma.project.findUnique({
        where: {
          organizationId_code: {
            organizationId,
            code: input.code,
          },
        },
      });
      if (codeCheck) {
        throw new ConflictException('PROJECT_CODE_EXISTS');
      }
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.code ? { code: input.code } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.workMode ? { workMode: input.workMode } : {}),
      },
    });
  }

  async createSite(organizationId: string, input: CreateSiteInput) {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, organizationId, status: 'ACTIVE' },
    });

    if (!project) {
      throw new NotFoundException('PROJECT_NOT_FOUND_OR_INACTIVE');
    }

    const site = await this.prisma.site.create({
      data: {
        organizationId,
        projectId: input.projectId,
        name: input.name,
        latitude: input.latitude,
        longitude: input.longitude,
        allowedRadiusMeters: input.allowedRadiusMeters,
        timezone: input.timezone,
        status: 'ACTIVE',
      },
    });

    if (project.telegramChatId) {
      await this.prisma.telegramReportGroup.updateMany({
        where: {
          organizationId,
          chatId: project.telegramChatId,
          siteId: null,
        },
        data: {
          siteId: site.id,
          status: 'ACTIVE',
        },
      });
    }

    return site;
  }

  async updateSite(organizationId: string, id: string, input: UpdateSiteInput) {
    const existing = await this.prisma.site.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException('SITE_NOT_FOUND');
    }

    return this.prisma.site.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.allowedRadiusMeters !== undefined ? { allowedRadiusMeters: input.allowedRadiusMeters } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
  }

  async updateEmployee(organizationId: string, id: string, input: UpdateEmployeeInput) {
    const existing = await this.prisma.employee.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('EMPLOYEE_NOT_FOUND');

    let normalizedPhone: string | null | undefined = undefined;
    if (input.phone !== undefined) {
      normalizedPhone = normalizePhone(input.phone);
      if (normalizedPhone) {
        const phoneConflict = await this.prisma.employee.findUnique({
          where: {
            organizationId_normalizedPhone: {
              organizationId,
              normalizedPhone,
            },
          },
        });
        if (phoneConflict && phoneConflict.id !== id) {
          throw new ConflictException('PHONE_NUMBER_EXISTS');
        }
      }
    }

    return this.prisma.employee.update({
      where: { id },
      data: {
        ...(input.fullName ? { fullName: input.fullName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone, normalizedPhone } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
  }

  async deleteEmployee(organizationId: string, id: string) {
    const existing = await this.prisma.employee.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('EMPLOYEE_NOT_FOUND');

    return this.prisma.employee.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  async deleteProject(organizationId: string, id: string) {
    const existing = await this.prisma.project.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('PROJECT_NOT_FOUND');

    return this.prisma.project.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  async deleteSite(organizationId: string, id: string) {
    const existing = await this.prisma.site.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('SITE_NOT_FOUND');

    return this.prisma.site.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  async createWorkSchedule(organizationId: string, input: CreateWorkScheduleInput) {
    return this.prisma.workSchedule.create({
      data: {
        organizationId,
        name: input.name,
        timezone: input.timezone,
        startTime: input.startTime,
        endTime: input.endTime,
        graceMinutes: input.graceMinutes,
      },
    });
  }

  async updateWorkSchedule(organizationId: string, id: string, input: UpdateWorkScheduleInput) {
    const existing = await this.prisma.workSchedule.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('SCHEDULE_NOT_FOUND');

    return this.prisma.workSchedule.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.startTime ? { startTime: input.startTime } : {}),
        ...(input.endTime ? { endTime: input.endTime } : {}),
        ...(input.graceMinutes !== undefined ? { graceMinutes: input.graceMinutes } : {}),
      },
    });
  }

  async deleteWorkSchedule(organizationId: string, id: string) {
    const existing = await this.prisma.workSchedule.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('SCHEDULE_NOT_FOUND');

    return this.prisma.workSchedule.delete({
      where: { id },
    });
  }

  async createAssignment(organizationId: string, input: CreateAssignmentInput) {
    const [employee, site, schedule] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: input.employeeId, organizationId, status: 'ACTIVE' } }),
      this.prisma.site.findFirst({ where: { id: input.siteId, organizationId, status: 'ACTIVE', project: { status: 'ACTIVE' } } }),
      this.prisma.workSchedule.findFirst({ where: { id: input.scheduleId, organizationId } }),
    ]);

    if (!employee) throw new NotFoundException('EMPLOYEE_NOT_FOUND_OR_INACTIVE');
    if (!site) throw new NotFoundException('SITE_NOT_FOUND_OR_INACTIVE');
    if (!schedule) throw new NotFoundException('SCHEDULE_NOT_FOUND');

    const startsOn = new Date(input.startsOn);
    const endsOn = input.endsOn ? new Date(input.endsOn) : null;

    if (endsOn && endsOn < startsOn) {
      throw new BadRequestException('ENDS_ON_BEFORE_STARTS_ON');
    }

    return this.prisma.assignment.create({
      data: {
        organizationId,
        employeeId: input.employeeId,
        siteId: input.siteId,
        scheduleId: input.scheduleId,
        startsOn,
        endsOn,
        status: 'ACTIVE',
      },
      include: {
        employee: true,
        site: true,
        schedule: true,
      },
    });
  }

  async updateAssignment(organizationId: string, id: string, input: UpdateAssignmentInput) {
    const existing = await this.prisma.assignment.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('ASSIGNMENT_NOT_FOUND');

    if (input.siteId || input.scheduleId) {
      const [site, schedule, attendanceCount] = await Promise.all([
        input.siteId ? this.prisma.site.findFirst({ where: { id: input.siteId, organizationId, status: 'ACTIVE', project: { status: 'ACTIVE' } } }) : null,
        input.scheduleId ? this.prisma.workSchedule.findFirst({ where: { id: input.scheduleId, organizationId } }) : null,
        this.prisma.attendanceRecord.count({ where: { organizationId, assignmentId: id } }),
      ]);
      if (input.siteId && !site) throw new NotFoundException('SITE_NOT_FOUND_OR_INACTIVE');
      if (input.scheduleId && !schedule) throw new NotFoundException('SCHEDULE_NOT_FOUND');
      if (attendanceCount > 0 && (input.siteId !== existing.siteId || input.scheduleId !== existing.scheduleId)) {
        throw new ConflictException('ASSIGNMENT_CANNOT_CHANGE_AFTER_ATTENDANCE');
      }
    }

    const startsOn = input.startsOn ? new Date(input.startsOn) : undefined;
    const endsOn = input.endsOn !== undefined ? (input.endsOn ? new Date(input.endsOn) : null) : undefined;

    return this.prisma.assignment.update({
      where: { id },
      data: {
        ...(input.siteId ? { siteId: input.siteId } : {}),
        ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
        ...(startsOn ? { startsOn } : {}),
        ...(endsOn !== undefined ? { endsOn } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
  }

  async deleteAssignment(organizationId: string, id: string) {
    const existing = await this.prisma.assignment.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('ASSIGNMENT_NOT_FOUND');

    return this.prisma.assignment.delete({
      where: { id },
    });
  }

  async linkTelegramAccount(
    organizationId: string,
    input: LinkTelegramInput,
    actorUserId?: string,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, organizationId, status: 'ACTIVE' },
      include: { telegramAccount: true },
    });

    if (!employee) {
      throw new NotFoundException('EMPLOYEE_NOT_FOUND_OR_INACTIVE');
    }

    if (employee.telegramAccount) {
      throw new ConflictException('EMPLOYEE_ALREADY_LINKED');
    }

    const existingTelegram = await this.prisma.telegramAccount.findFirst({
      where: { organizationId, telegramUserId: input.telegramUserId },
    });

    if (existingTelegram) {
      throw new ConflictException('TELEGRAM_ALREADY_LINKED');
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.telegramAccount.create({
        data: {
          organizationId,
          employeeId: input.employeeId,
          telegramUserId: input.telegramUserId,
          username: input.username,
          status: 'ACTIVE',
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: 'TELEGRAM_ACCOUNT_LINKED',
          targetType: 'TelegramAccount',
          targetId: account.id,
          metadata: {
            employeeId: input.employeeId,
            telegramUserId: input.telegramUserId,
          },
        },
      });

      return account;
    });
  }

  async listEmployees(organizationId: string, scope?: AdminDataScope) {
    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId,
        ...(!scope || scope.unrestricted
          ? {}
          : {
              OR: [
                { currentProjectId: { in: scope.projectIds } },
                { assignments: { some: { site: { OR: [{ projectId: { in: scope.projectIds } }, { id: { in: scope.siteIds } }] } } } },
              ],
            }),
      },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        jobTitle: true,
        phone: true,
        avatarUrl: true,
        status: true,
        currentPosition: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        telegramAccount: {
          select: {
            id: true,
            telegramUserId: true,
            username: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
            status: true,
            lastVerifiedAt: true,
          },
        },
      },
      orderBy: { employeeCode: 'asc' },
    });

    return employees.map((emp) => ({
      id: emp.id,
      employeeCode: emp.employeeCode,
      fullName: emp.fullName,
      jobTitle: emp.jobTitle,
      phone: maskPhone(emp.phone),
      avatarUrl: emp.avatarUrl,
      status: emp.status,
      currentPosition: emp.currentPosition
        ? {
            id: emp.currentPosition.id,
            code: emp.currentPosition.code,
            name: emp.currentPosition.name,
          }
        : null,
      telegramAccount: emp.telegramAccount
        ? {
            id: emp.telegramAccount.id,
            telegramUserId: emp.telegramAccount.telegramUserId,
            username: emp.telegramAccount.username,
            firstName: emp.telegramAccount.firstName,
            lastName: emp.telegramAccount.lastName,
            photoUrl: emp.telegramAccount.photoUrl,
            status: emp.telegramAccount.status,
            lastVerifiedAt: emp.telegramAccount.lastVerifiedAt?.toISOString() ?? null,
          }
        : null,
    }));
  }

  async listProjects(organizationId: string, scope?: AdminDataScope) {
    const projects = await this.prisma.project.findMany({
      where: { organizationId, ...(!scope || scope.unrestricted ? {} : { id: { in: scope.projectIds } }) },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        workMode: true,
        telegramChatId: true,
        telegramConnectionStatus: true,
        telegramHealthCheckedAt: true,
        telegramHealthError: true,
        _count: {
          select: { sites: true },
        },
      },
      orderBy: { code: 'asc' },
    });

    return projects.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      workMode: p.workMode,
      telegramChatId: p.telegramChatId,
      telegramConnectionStatus: p.telegramConnectionStatus,
      telegramHealthCheckedAt: p.telegramHealthCheckedAt?.toISOString() ?? null,
      telegramHealthError: p.telegramHealthError,
      sitesCount: p._count.sites,
    }));
  }

  async getProjectDetail(organizationId: string, projectId: string, scope?: AdminDataScope) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, ...(!scope || scope.unrestricted ? {} : { id: { in: scope.projectIds } }) },
      include: {
        sites: true,
        workerConnections: { include: { employee: { select: { id: true, employeeCode: true, fullName: true, status: true } } }, orderBy: { lastSelectedAt: 'desc' } },
        attendanceRecords: { include: { employee: { select: { id: true, employeeCode: true, fullName: true } }, site: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!project) throw new NotFoundException('PROJECT_NOT_FOUND');
    const [reportGroup, accessEvents] = await Promise.all([
      project.telegramChatId ? this.prisma.telegramReportGroup.findFirst({ where: { organizationId, chatId: project.telegramChatId } }) : null,
      this.prisma.auditLog.findMany({ where: { organizationId, targetType: 'Project', targetId: project.id }, orderBy: { occurredAt: 'desc' }, take: 100 }),
    ]);
    return {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      telegramConnectedAt: project.telegramConnectedAt?.toISOString() ?? null,
      telegramHealthCheckedAt: project.telegramHealthCheckedAt?.toISOString() ?? null,
      sites: project.sites.map((site) => ({ ...site, latitude: Number(site.latitude), longitude: Number(site.longitude) })),
      workerConnections: project.workerConnections.map((connection) => ({ ...connection, connectedAt: connection.connectedAt.toISOString(), lastSelectedAt: connection.lastSelectedAt?.toISOString() ?? null, lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null, revokedAt: connection.revokedAt?.toISOString() ?? null })),
      attendanceRecords: project.attendanceRecords.map((record) => ({ ...record, attendanceDate: record.attendanceDate.toISOString().slice(0, 10), checkInAt: (record.adjustedCheckInAt ?? record.checkInAt)?.toISOString() ?? null, checkOutAt: (record.adjustedCheckOutAt ?? record.checkOutAt)?.toISOString() ?? null, status: record.adjustedStatus ?? record.status })),
      reportGroup,
      accessEvents: accessEvents.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
    };
  }

  async getEmployeeDetail(organizationId: string, employeeId: string, scope?: AdminDataScope) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationId,
        ...(!scope || scope.unrestricted
          ? {}
          : { OR: [{ currentProjectId: { in: scope.projectIds } }, { assignments: { some: { site: { OR: [{ projectId: { in: scope.projectIds } }, { id: { in: scope.siteIds } }] } } } }] }),
      },
      include: {
        telegramAccount: true,
        currentProject: true,
        projectConnections: { where: !scope || scope.unrestricted ? undefined : { projectId: { in: scope.projectIds } }, include: { project: true }, orderBy: { lastSelectedAt: 'desc' } },
        attendance: { where: !scope || scope.unrestricted ? undefined : { OR: [{ projectId: { in: scope.projectIds } }, { adjustedProjectId: { in: scope.projectIds } }, { siteId: { in: scope.siteIds } }] }, include: { project: true, adjustedProject: true, site: true }, orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!employee) throw new NotFoundException('EMPLOYEE_NOT_FOUND');
    const activity = await this.prisma.auditLog.findMany({ where: { organizationId, OR: [{ metadata: { path: ['employeeId'], equals: employeeId } }, { targetType: 'Employee', targetId: employeeId }] }, orderBy: { occurredAt: 'desc' }, take: 100 });
    return {
      ...employee,
      projectConnections: employee.projectConnections.map((connection) => ({ ...connection, connectedAt: connection.connectedAt.toISOString(), lastSelectedAt: connection.lastSelectedAt?.toISOString() ?? null, lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null, revokedAt: connection.revokedAt?.toISOString() ?? null })),
      attendance: employee.attendance.map((record) => ({
          id: record.id,
          attendanceDate: record.attendanceDate.toISOString().slice(0, 10),
          project: record.adjustedProject ?? record.project,
          site: record.site,
          checkInAt: (record.adjustedCheckInAt ?? record.checkInAt)?.toISOString() ?? null,
          checkOutAt: (record.adjustedCheckOutAt ?? record.checkOutAt)?.toISOString() ?? null,
          status: record.adjustedStatus ?? record.status,
        })),
      activity: activity.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
    };
  }

  private async createEvidenceSignedUrl(storagePath: string | null): Promise<string | null> {
    if (!storagePath) return null;
    const baseUrl = this.configService.get<string>('SUPABASE_URL') ?? process.env.SUPABASE_URL;
    const serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) return null;
    try {
      const response = await fetch(`${baseUrl}/storage/v1/object/sign/attendance-evidence/${storagePath}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { signedURL?: string; signedUrl?: string };
      const signedPath = payload.signedURL ?? payload.signedUrl;
      if (!signedPath) return null;
      return signedPath.startsWith('http') ? signedPath : `${baseUrl}/storage/v1${signedPath}`;
    } catch {
      return null;
    }
  }

  async listSecurityEvents(organizationId: string, limit = 100, scope?: AdminDataScope) {
    const scopedTargets = !scope || scope.unrestricted
      ? undefined
      : [
          ...scope.projectIds.map((projectId) => ({ targetType: 'Project', targetId: projectId })),
          ...scope.siteIds.map((siteId) => ({ targetType: 'Site', targetId: siteId })),
        ];
    const events = await this.prisma.auditLog.findMany({
      where: { organizationId, action: { in: ['PROJECT_ACCESS_DENIED', 'WORKER_CURRENT_PROJECT_SET', 'TELEGRAM_REPORT_GROUP_CONNECTED', 'TELEGRAM_REPORT_GROUP_CONFIGURED'] }, ...(scopedTargets ? { OR: scopedTargets } : {}) },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    return events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() }));
  }

  async listSites(organizationId: string, scope?: AdminDataScope) {
    const sites = await this.prisma.site.findMany({
      // Archived sites remain in the database for audit/history, but must not
      // appear in the active workforce management list.
      where: { organizationId, status: 'ACTIVE', ...(!scope || scope.unrestricted ? {} : { OR: [{ projectId: { in: scope.projectIds } }, { id: { in: scope.siteIds } }] }) },
      select: {
        id: true,
        projectId: true,
        name: true,
        latitude: true,
        longitude: true,
        allowedRadiusMeters: true,
        timezone: true,
        status: true,
        project: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });

    return sites.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      projectName: s.project.name,
      name: s.name,
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      allowedRadiusMeters: s.allowedRadiusMeters,
      timezone: s.timezone,
      status: s.status,
    }));
  }

  async listWorkSchedules(organizationId: string) {
    const schedules = await this.prisma.workSchedule.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        timezone: true,
        startTime: true,
        endTime: true,
        graceMinutes: true,
      },
      orderBy: { name: 'asc' },
    });

    return schedules.map((s) => ({
      id: s.id,
      name: s.name,
      timezone: s.timezone,
      startTime: s.startTime,
      endTime: s.endTime,
      graceMinutes: s.graceMinutes,
    }));
  }

  async listAssignments(organizationId: string, scope?: AdminDataScope) {
    const assignments = await this.prisma.assignment.findMany({
      where: { organizationId, ...(!scope || scope.unrestricted ? {} : { site: { OR: [{ projectId: { in: scope.projectIds } }, { id: { in: scope.siteIds } }] } }) },
      select: {
        id: true,
        employeeId: true,
        siteId: true,
        scheduleId: true,
        startsOn: true,
        endsOn: true,
        status: true,
        employee: { select: { fullName: true, employeeCode: true } },
        site: {
          select: {
            projectId: true,
            name: true,
            project: { select: { name: true } },
          },
        },
        schedule: { select: { name: true } },
      },
      orderBy: { startsOn: 'desc' },
    });

    return assignments.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      employeeName: a.employee.fullName,
      employeeCode: a.employee.employeeCode,
      siteId: a.siteId,
      siteName: a.site.name,
      projectId: a.site.projectId,
      projectName: a.site.project.name,
      scheduleId: a.scheduleId,
      scheduleName: a.schedule.name,
      startsOn: a.startsOn.toISOString().slice(0, 10),
      endsOn: a.endsOn ? a.endsOn.toISOString().slice(0, 10) : null,
      status: a.status,
    }));
  }

  async listAuditLogs(organizationId: string, limit = 50, scope?: AdminDataScope) {
    const logs = await this.prisma.auditLog.findMany({
      where: { organizationId, ...(!scope || scope.unrestricted ? {} : { OR: [{ targetType: 'Project', targetId: { in: scope.projectIds } }, { targetType: 'Site', targetId: { in: scope.siteIds } }] }) },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });

    return logs.map((l) => ({
      id: l.id,
      actorUserId: l.actorUserId,
      action: l.action,
      targetType: l.targetType,
      targetId: l.targetId,
      metadata: l.metadata as Record<string, unknown> | null,
      createdAt: l.occurredAt.toISOString(),
    }));
  }
}
