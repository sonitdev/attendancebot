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
import { adminLoginSchema, type AdminSessionResponse } from '@workforce/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from './decorators/public.decorator.js';
import { SessionService } from './session.service.js';

@Controller('auth')
export class AdminAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {}

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

    const { email, orgSlug } = parseResult.data;
    const cleanEmail = email.trim().toLowerCase();
    const cleanOrgSlug = orgSlug.trim().toLowerCase();

    let org = await this.prisma.organization.findUnique({
      where: { slug: cleanOrgSlug },
    });

    if (!org && (cleanOrgSlug === 'acme' || cleanOrgSlug === 'workforce')) {
      org = await this.prisma.organization.create({
        data: {
          slug: cleanOrgSlug,
          name: 'Acme Site Construction Ltd.',
        },
      });
    }

    if (!org) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    let user = await this.prisma.user.findUnique({
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

    // Dev bypass auto-provisioning for Admin, HR, and Engineering Manager
    if (!user) {
      let devRoleCode: string | null = null;
      let roleName = '';
      if (cleanEmail.includes('admin') || cleanEmail.includes('owner')) {
        devRoleCode = 'OWNER';
        roleName = 'Organization Owner';
      } else if (cleanEmail.includes('hr')) {
        devRoleCode = 'HR';
        roleName = 'Human Resources Manager';
      } else if (cleanEmail.includes('eng') || cleanEmail.includes('manager')) {
        devRoleCode = 'SITE_MANAGER';
        roleName = 'Engineering Site Manager';
      }

      if (devRoleCode) {
        const role = await this.prisma.role.upsert({
          where: {
            organizationId_code: {
              organizationId: org.id,
              code: devRoleCode,
            },
          },
          update: {},
          create: {
            organizationId: org.id,
            code: devRoleCode,
            name: roleName,
          },
        });

        user = await this.prisma.user.create({
          data: {
            organizationId: org.id,
            email: cleanEmail,
            status: 'ACTIVE',
            roles: {
              create: {
                roleId: role.id,
              },
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
      }
    }

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const roles = user.roles.map((ur) => ur.role.code);
    if (roles.length === 0) {
      throw new ForbiddenException('NO_ADMIN_ROLES');
    }

    const { token, expiresAt } = this.sessionService.createAdminToken({
      userId: user.id,
      organizationId: org.id,
      email: user.email,
      roles,
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        roles,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
    };
  }
}
