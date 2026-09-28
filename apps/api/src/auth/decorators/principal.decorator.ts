import { createParamDecorator, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { isAdminPrincipal, isWorkerPrincipal, type AdminPrincipal, type Principal, type WorkerPrincipal } from '../principal.js';

interface RequestWithAuth {
  principal?: Principal;
  organizationId?: string;
  headers: Record<string, string | string[] | undefined>;
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    if (!req.principal) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    return req.principal;
  },
);

export const CurrentOrganizationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    const orgId = req.organizationId ?? req.principal?.organizationId;
    if (!orgId) {
      throw new UnauthorizedException('MISSING_ORGANIZATION_CONTEXT');
    }
    return orgId;
  },
);

export const CurrentWorker = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkerPrincipal => {
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    if (!req.principal) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    if (!isWorkerPrincipal(req.principal)) {
      throw new ForbiddenException('WORKER_REQUIRED');
    }
    return req.principal;
  },
);

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    if (!req.principal) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    if (!isAdminPrincipal(req.principal)) {
      throw new ForbiddenException('ADMIN_REQUIRED');
    }
    return req.principal;
  },
);

