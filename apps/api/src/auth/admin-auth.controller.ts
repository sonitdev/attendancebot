import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { adminLoginSchema, adminRegistrationSchema, type AdminSessionResponse } from '@workforce/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from './decorators/public.decorator.js';
import { PasswordCredentialService } from './password-credential.service.js';
import { SessionService } from './session.service.js';

@Controller('auth')
export class AdminAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: PasswordCredentialService,
    private readonly sessionService: SessionService,
  ) {}

  private createResponse(
    user: { id: string; email: string; roles: Array<{ role: { code: string } }> },
    organization: { id: string; name: string; slug: string },
  ): AdminSessionResponse {
    const roles = user.roles.map((item) => item.role.code);
    const { token, expiresAt } = this.sessionService.createAdminToken({
      userId: user.id,
      organizationId: organization.id,
      email: user.email,
      roles,
    });
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, email: user.email, roles },
      organization,
    };
  }

  @Public()
  @Post('register-organization')
  @HttpCode(HttpStatus.CREATED)
  async registerOrganization(@Body() body: unknown): Promise<AdminSessionResponse> {
    const parsed = adminRegistrationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }
    const input = parsed.data;
    const existing = await this.prisma.organization.findUnique({ where: { slug: input.orgSlug } });
    if (existing) throw new BadRequestException('ORGANIZATION_SLUG_ALREADY_EXISTS');

    const passwordHash = this.credentials.hash(input.password);
    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.organizationName, slug: input.orgSlug },
      });
      const roles = [
        ['OWNER', 'Organization Owner'],
        ['HR', 'Human Resources'],
        ['PROJECT_MANAGER', 'Project Manager'],
        ['SITE_MANAGER', 'Site Manager'],
        ['VIEWER', 'Read-Only Viewer'],
      ] as const;
      await tx.role.createMany({
        data: roles.map(([code, name]) => ({ organizationId: organization.id, code, name })),
      });
      const ownerRole = await tx.role.findUniqueOrThrow({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: 'OWNER',
          },
        },
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          passwordHash,
          roles: { create: { roleId: ownerRole.id } },
        },
        include: { roles: { include: { role: true } } },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorUserId: user.id,
          action: 'ORGANIZATION_REGISTERED',
          targetType: 'Organization',
          targetId: organization.id,
          metadata: { ownerEmail: user.email },
        },
      });
      return { organization, user };
    }, {
      // Organization bootstrap intentionally creates the tenant boundary,
      // default roles, first owner, and audit event atomically. Remote
      // PostgreSQL latency can exceed Prisma's 5-second interactive default.
      maxWait: 10_000,
      timeout: 20_000,
    });
    return this.createResponse(result.user, result.organization);
  }

  @Public()
  @Post('admin-login')
  @HttpCode(HttpStatus.OK)
  async adminLogin(@Body() body: unknown): Promise<AdminSessionResponse> {
    const parseResult = adminLoginSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        errors: parseResult.error.errors,
      });
    }

    const { email, orgSlug, password } = parseResult.data;
    const cleanEmail = email.trim().toLowerCase();
    const cleanOrgSlug = orgSlug.trim().toLowerCase();

    const org = await this.prisma.organization.findUnique({
      where: { slug: cleanOrgSlug },
    });

    if (!org) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: org.id,
          email: cleanEmail,
        },
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE' || !this.credentials.verify(password, user.passwordHash)) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const roles = user.roles.map((ur) => ur.role.code);
    if (roles.length === 0) {
      throw new ForbiddenException('NO_ADMIN_ROLES');
    }

    return this.createResponse(user, { id: org.id, name: org.name, slug: org.slug });
  }
}
