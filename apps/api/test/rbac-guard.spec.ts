import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../src/auth/decorators/public.decorator.js';
import { PERMISSIONS_KEY, ROLES_KEY } from '../src/auth/decorators/rbac.decorators.js';
import { AuthGuard } from '../src/auth/guards/auth.guard.js';
import { RbacGuard } from '../src/auth/guards/rbac.guard.js';
import type { AdminPrincipal, WorkerPrincipal } from '../src/auth/principal.js';
import type { SessionService } from '../src/auth/session.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

function createMockExecutionContext(options: {
  headers?: Record<string, string | undefined>;
  params?: Record<string, string>;
  principal?: any;
}): ExecutionContext {
  const req = {
    headers: options.headers ?? {},
    params: options.params ?? {},
    principal: options.principal,
    organizationId: options.principal?.organizationId,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('AuthGuard and RbacGuard Tenant Isolation and RBAC', () => {
  let reflector: Reflector;
  let rbacGuard: RbacGuard;
  let sessionService: SessionService;
  let authGuard: AuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    rbacGuard = new RbacGuard(reflector);

    sessionService = {
      verifyWorkerToken: vi.fn(),
      verifyToken: vi.fn(),
    } as unknown as SessionService;

    authGuard = new AuthGuard(reflector, sessionService, {
      telegramAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'account-1' }) },
    } as unknown as PrismaService);
  });

  describe('AuthGuard', () => {
    it('allows access to public endpoints without any token', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === IS_PUBLIC_KEY) return true;
        return undefined;
      });

      const context = createMockExecutionContext({});
      await expect(authGuard.canActivate(context)).resolves.toBe(true);
    });

    it('rejects protected endpoint when Authorization header is missing', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === IS_PUBLIC_KEY) return false;
        return undefined;
      });

      const context = createMockExecutionContext({});
      await expect(authGuard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('successfully validates Bearer token and sets principal on request', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === IS_PUBLIC_KEY) return false;
        return undefined;
      });

      const workerPrincipal: WorkerPrincipal = {
        type: 'worker',
        organizationId: 'org-tenant-1',
        employeeId: 'emp-1',
        telegramUserId: 'tg-1',
        sessionId: 'session-1',
      };
      (sessionService.verifyToken as any).mockReturnValue(workerPrincipal);

      const context = createMockExecutionContext({
        headers: { authorization: 'Bearer valid-token' },
      });

      await expect(authGuard.canActivate(context)).resolves.toBe(true);
      const req: any = context.switchToHttp().getRequest();
      expect(req.principal).toEqual(workerPrincipal);
      expect(req.organizationId).toBe('org-tenant-1');
    });
  });

  describe('RbacGuard Organization Scoping and Tenant Isolation', () => {
    const workerPrincipal: WorkerPrincipal = {
      type: 'worker',
      organizationId: 'org-tenant-1',
      employeeId: 'emp-1',
      telegramUserId: 'tg-1',
      sessionId: 'session-1',
    };

    const adminPrincipal: AdminPrincipal = {
      type: 'admin',
      organizationId: 'org-tenant-1',
      userId: 'user-admin-1',
      email: 'admin@tenant1.com',
      roles: ['PROJECT_MANAGER'],
      permissions: ['attendance:read', 'sites:read'],
    };

    it('allows access when target organization matches principal organization', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      const context = createMockExecutionContext({
        params: { organizationId: 'org-tenant-1' },
        principal: workerPrincipal,
      });

      expect(rbacGuard.canActivate(context)).toBe(true);
    });

    it('rejects cross-organization access via params with FORBIDDEN_SCOPE', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      const context = createMockExecutionContext({
        params: { organizationId: 'org-tenant-2' }, // Different tenant!
        principal: workerPrincipal,
      });

      expect(() => rbacGuard.canActivate(context)).toThrow(new ForbiddenException('FORBIDDEN_SCOPE'));
    });

    it('rejects cross-organization access via header with FORBIDDEN_SCOPE', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      const context = createMockExecutionContext({
        headers: { 'x-organization-id': 'org-tenant-2' }, // Cross-tenant attempt!
        principal: workerPrincipal,
      });

      expect(() => rbacGuard.canActivate(context)).toThrow(new ForbiddenException('FORBIDDEN_SCOPE'));
    });

    it('rejects worker principals from accessing admin routes requiring roles', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return ['HR', 'OWNER'];
        return undefined;
      });

      const context = createMockExecutionContext({
        principal: workerPrincipal,
      });

      expect(() => rbacGuard.canActivate(context)).toThrow(new ForbiddenException('FORBIDDEN_SCOPE'));
    });

    it('rejects worker principals from accessing admin routes requiring permissions', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === PERMISSIONS_KEY) return ['employee:create'];
        return undefined;
      });

      const context = createMockExecutionContext({
        principal: workerPrincipal,
      });

      expect(() => rbacGuard.canActivate(context)).toThrow(new ForbiddenException('FORBIDDEN_SCOPE'));
    });

    it('allows admin principal who possesses the required role', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return ['PROJECT_MANAGER'];
        return undefined;
      });

      const context = createMockExecutionContext({
        principal: adminPrincipal,
      });

      expect(rbacGuard.canActivate(context)).toBe(true);
    });

    it('rejects admin principal missing the required role with FORBIDDEN_SCOPE', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return ['OWNER']; // Admin only has PROJECT_MANAGER
        return undefined;
      });

      const context = createMockExecutionContext({
        principal: adminPrincipal,
      });

      expect(() => rbacGuard.canActivate(context)).toThrow(new ForbiddenException('FORBIDDEN_SCOPE'));
    });

    it('allows admin principal who possesses all required permissions', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === PERMISSIONS_KEY) return ['attendance:read', 'sites:read'];
        return undefined;
      });

      const context = createMockExecutionContext({
        principal: adminPrincipal,
      });

      expect(rbacGuard.canActivate(context)).toBe(true);
    });

    it('rejects admin principal missing one of the required permissions with FORBIDDEN_SCOPE', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === PERMISSIONS_KEY) return ['attendance:read', 'attendance:override']; // Missing attendance:override
        return undefined;
      });

      const context = createMockExecutionContext({
        principal: adminPrincipal,
      });

      expect(() => rbacGuard.canActivate(context)).toThrow(new ForbiddenException('FORBIDDEN_SCOPE'));
    });
  });
});
