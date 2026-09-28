import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { PERMISSIONS_KEY, ROLES_KEY } from '../decorators/rbac.decorators.js';
import { isAdminPrincipal, type Principal } from '../principal.js';

interface RequestWithAuthAndParams {
  principal?: Principal;
  organizationId?: string;
  params?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuthAndParams>();
    const principal = request.principal;

    if (!principal) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    // 1. Enforce organization boundary against route params or headers if present
    const targetOrgId =
      request.params?.organizationId ??
      request.params?.orgId ??
      (typeof request.headers['x-organization-id'] === 'string' ? request.headers['x-organization-id'] : undefined);

    if (targetOrgId && targetOrgId !== principal.organizationId) {
      throw new ForbiddenException('FORBIDDEN_SCOPE');
    }

    // 2. Enforce roles if required
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles && requiredRoles.length > 0) {
      if (!isAdminPrincipal(principal)) {
        throw new ForbiddenException('FORBIDDEN_SCOPE');
      }

      const hasRole = requiredRoles.some((role) => principal.roles.includes(role));
      if (!hasRole) {
        throw new ForbiddenException('FORBIDDEN_SCOPE');
      }
    }

    // 3. Enforce permissions if required
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredPermissions && requiredPermissions.length > 0) {
      if (!isAdminPrincipal(principal)) {
        throw new ForbiddenException('FORBIDDEN_SCOPE');
      }

      const hasPermission = requiredPermissions.every((perm) => principal.permissions.includes(perm));
      if (!hasPermission) {
        throw new ForbiddenException('FORBIDDEN_SCOPE');
      }
    }

    return true;
  }
}
