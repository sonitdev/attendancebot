import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { Principal } from '../principal.js';
import { SessionService } from '../session.service.js';

interface RequestWithAuth {
  principal?: Principal;
  organizationId?: string;
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const authHeader = (request.headers.authorization || request.headers['x-worker-session']) as string | undefined;

    if (!authHeader) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    if (!token) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    const principal = this.sessionService.verifyToken(token);
    request.principal = principal;
    request.organizationId = principal.organizationId;

    return true;
  }
}
