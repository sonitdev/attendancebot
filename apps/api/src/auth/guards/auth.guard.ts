import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { Principal } from '../principal.js';
import { SessionService } from '../session.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CacheService } from '../../common/cache/cache.service.js';
import { markVerifiedWorker } from '../verified-worker.js';
import { timeStep } from '../../common/performance/request-timing.js';

interface RequestWithAuth {
  principal?: Principal;
  organizationId?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    return timeStep('auth', () => this.authorize(context));
  }

  private async authorize(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const authHeader = (request.headers.authorization || request.headers['x-worker-session']) as string | undefined;

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    if (!token) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    const principal = this.sessionService.verifyToken(token);
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    const fresh = <T>(key: string, load: () => Promise<T>): Promise<T> =>
      isRead && this.cache ? this.cache.coalesce(key, load) : load();
    if (principal.type === 'worker') {
      const account = await fresh(JSON.stringify([
        'auth-worker', principal.organizationId, principal.employeeId, principal.telegramUserId,
      ]), () => this.prisma.telegramAccount.findFirst({
        where: {
          telegramUserId: principal.telegramUserId,
          employeeId: principal.employeeId,
          organizationId: principal.organizationId,
          status: 'ACTIVE',
          employee: { status: 'ACTIVE', organizationId: principal.organizationId },
        },
        select: { id: true },
      }));
      if (!account) throw new UnauthorizedException('WORKER_SESSION_REVOKED');
      markVerifiedWorker(principal);
    } else {
      const user = await fresh(JSON.stringify(['auth-admin', principal.organizationId, principal.userId]),
        () => this.prisma.user.findFirst({
          where: { id: principal.userId, organizationId: principal.organizationId, status: 'ACTIVE' },
          select: { roles: { select: { role: { select: { code: true } } } } },
        }));
      if (!user) throw new UnauthorizedException('ADMIN_SESSION_REVOKED');
      principal.roles = user.roles.map((item) => item.role.code);
    }
    request.principal = principal;
    request.organizationId = principal.organizationId;

    return true;
  }
}
