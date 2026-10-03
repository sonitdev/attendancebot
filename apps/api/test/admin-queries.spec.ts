import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from '../src/admin/admin.service.js';
import { AdminAuthController } from '../src/auth/admin-auth.controller.js';
import { SessionService } from '../src/auth/session.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('Admin Authentication and Resource Queries', () => {
  let sessionService: SessionService;
  let adminService: AdminService;
  let adminAuthController: AdminAuthController;
  let mockPrisma: any;

  beforeEach(() => {
    sessionService = new SessionService({
      get: vi.fn((key: string) => {
        if (key === 'SESSION_SECRET') return '0123456789abcdef0123456789abcdef';
        return null;
      }),
    } as any);

    mockPrisma = {
      organization: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      employee: {
        findMany: vi.fn(),
      },
      project: {
        findMany: vi.fn(),
      },
      site: {
        findMany: vi.fn(),
      },
      workSchedule: {
        findMany: vi.fn(),
      },
      assignment: {
        findMany: vi.fn(),
      },
      auditLog: {
        findMany: vi.fn(),
      },
    };

    adminService = new AdminService(mockPrisma as unknown as PrismaService);
    adminAuthController = new AdminAuthController(
      mockPrisma as unknown as PrismaService,
      { verify: vi.fn().mockReturnValue(true) } as any,
      sessionService,
    );
  });

  describe('SessionService admin tokens', () => {
    it('creates and verifies a valid admin token', () => {
      const now = new Date('2026-09-18T10:00:00.000Z');
      const { token, expiresAt } = sessionService.createAdminToken(
        {
          userId: 'user-1',
          organizationId: 'org-1',
          email: 'admin@acme.com',
          roles: ['OWNER', 'HR'],
        },
        now,
      );

      expect(token).toBeDefined();
      expect(expiresAt.getTime()).toBeGreaterThan(now.getTime());

      const principal = sessionService.verifyToken(token, now);
      expect(principal.type).toBe('admin');
      if (principal.type === 'admin') {
        expect(principal.userId).toBe('user-1');
        expect(principal.organizationId).toBe('org-1');
        expect(principal.email).toBe('admin@acme.com');
        expect(principal.roles).toEqual(['OWNER', 'HR']);
      }
    });

    it('rejects expired admin token', () => {
      const issuedAt = new Date('2026-09-18T10:00:00.000Z');
      const { token } = sessionService.createAdminToken(
        {
          userId: 'user-1',
          organizationId: 'org-1',
          email: 'admin@acme.com',
          roles: ['OWNER'],
          ttlSeconds: 60,
        },
        issuedAt,
      );

      const future = new Date('2026-09-18T10:02:00.000Z');
      expect(() => sessionService.verifyToken(token, future)).toThrow(UnauthorizedException);
    });
  });

  describe('AdminAuthController.adminLogin', () => {
    it('throws UnauthorizedException if organization not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        adminAuthController.adminLogin({
          email: 'admin@acme.com',
          orgSlug: 'unknown-slug',
          password: 'test-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if user not found or inactive', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme' });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        adminAuthController.adminLogin({
          email: 'inactive@acme.com',
          orgSlug: 'acme',
          password: 'test-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException if user has no assigned roles', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-no-role',
        email: 'norole@acme.com',
        status: 'ACTIVE',
        roles: [],
      });

      await expect(
        adminAuthController.adminLogin({
          email: 'norole@acme.com',
          orgSlug: 'acme',
          password: 'test-password',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('successfully logs in active admin and returns session token', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        slug: 'acme',
        name: 'Acme Site Construction Ltd.',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-admin',
        email: 'admin@acme.com',
        status: 'ACTIVE',
        roles: [
          { role: { code: 'OWNER', name: 'Owner' } },
          { role: { code: 'HR', name: 'HR' } },
        ],
      });

      const response = await adminAuthController.adminLogin({
        email: 'admin@acme.com',
        orgSlug: 'acme',
        password: 'test-password',
      });

      expect(response.token).toBeDefined();
      expect(response.user.email).toBe('admin@acme.com');
      expect(response.user.roles).toEqual(['OWNER', 'HR']);
      expect(response.organization.slug).toBe('acme');
    });
  });

  describe('AdminService list queries', () => {
    it('listEmployees enforces organizationId filter', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-1',
          employeeCode: 'EMP-001',
          fullName: 'Sokha Chan',
          jobTitle: 'Technician',
          phone: '+85512345678',
          avatarUrl: null,
          status: 'ACTIVE',
          telegramAccount: {
            id: 'tg-1',
            telegramUserId: '12345',
            username: 'sokha',
            firstName: 'Sokha',
            lastName: 'Chan',
            photoUrl: 'https://example.com/photo.jpg',
            status: 'ACTIVE',
            lastVerifiedAt: new Date('2026-09-18T08:00:00.000Z'),
          },
        },
      ]);

      const result = await adminService.listEmployees('org-1');
      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
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
      expect(result).toHaveLength(1);
      expect(result[0].employeeCode).toBe('EMP-001');
      expect(result[0].telegramAccount?.username).toBe('sokha');
    });

    it('listProjects returns projects with site counts', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 'proj-1',
          code: 'PRJ-ALPHA',
          name: 'Riverside Tower',
          status: 'ACTIVE',
          _count: { sites: 3 },
        },
      ]);

      const result = await adminService.listProjects('org-1');
      expect(mockPrisma.project.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
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
          _count: { select: { sites: true } },
        },
        orderBy: { code: 'asc' },
      });
      expect(result).toEqual([
        {
          id: 'proj-1',
          code: 'PRJ-ALPHA',
          name: 'Riverside Tower',
          status: 'ACTIVE',
          workMode: undefined,
          telegramChatId: undefined,
          telegramConnectionStatus: undefined,
          telegramHealthCheckedAt: null,
          telegramHealthError: undefined,
          sitesCount: 3,
        },
      ]);
    });

    it('listSites transforms numeric coordinates', async () => {
      mockPrisma.site.findMany.mockResolvedValue([
        {
          id: 'site-1',
          projectId: 'proj-1',
          name: 'Site A',
          latitude: '11.556400',
          longitude: '104.928200',
          allowedRadiusMeters: 100,
          timezone: 'Asia/Phnom_Penh',
          status: 'ACTIVE',
          project: { name: 'Riverside Tower' },
        },
      ]);

      const result = await adminService.listSites('org-1');
      expect(result[0].latitude).toBe(11.5564);
      expect(result[0].longitude).toBe(104.9282);
      expect(result[0].projectName).toBe('Riverside Tower');
    });

    it('listAuditLogs limits results and orders by occurredAt descending', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          actorUserId: 'user-1',
          action: 'TELEGRAM_ACCOUNT_LINKED',
          targetType: 'TelegramAccount',
          targetId: 'tg-1',
          metadata: { employeeId: 'emp-1' },
          occurredAt: new Date('2026-09-18T10:00:00.000Z'),
        },
      ]);

      const result = await adminService.listAuditLogs('org-1', 20);
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      });
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('TELEGRAM_ACCOUNT_LINKED');
    });
  });
});
