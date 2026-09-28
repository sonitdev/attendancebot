import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
} from '@workforce/contracts';
import { maskPhone, normalizePhone } from '../common/phone.util.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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
      },
    });
  }

  async createSite(organizationId: string, input: CreateSiteInput) {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, organizationId },
    });

    if (!project) {
      throw new NotFoundException('PROJECT_NOT_FOUND');
    }

    return this.prisma.site.create({
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

    return this.prisma.employee.delete({
      where: { id },
    });
  }

  async deleteProject(organizationId: string, id: string) {
    const existing = await this.prisma.project.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('PROJECT_NOT_FOUND');

    return this.prisma.project.delete({
      where: { id },
    });
  }

  async deleteSite(organizationId: string, id: string) {
    const existing = await this.prisma.site.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('SITE_NOT_FOUND');

    return this.prisma.site.delete({
      where: { id },
    });
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
      this.prisma.site.findFirst({ where: { id: input.siteId, organizationId, status: 'ACTIVE' } }),
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

    const existingTelegram = await this.prisma.telegramAccount.findUnique({
      where: { telegramUserId: input.telegramUserId },
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

  async listEmployees(organizationId: string) {
    const employees = await this.prisma.employee.findMany({
      where: { organizationId },
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

  async listProjects(organizationId: string) {
    const projects = await this.prisma.project.findMany({
      where: { organizationId },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
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
      sitesCount: p._count.sites,
    }));
  }

  async listSites(organizationId: string) {
    const sites = await this.prisma.site.findMany({
      where: { organizationId },
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

  async listAssignments(organizationId: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: { organizationId },
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

  async listAuditLogs(organizationId: string, limit = 50) {
    const logs = await this.prisma.auditLog.findMany({
      where: { organizationId },
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
