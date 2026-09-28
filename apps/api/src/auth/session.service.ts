import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AdminPrincipal, Principal, WorkerPrincipal } from './principal.js';

interface WorkerTokenPayload {
  sub: string; // employeeId
  orgId: string; // organizationId
  tgId: string; // telegramUserId
  sid: string; // sessionId
  type: 'worker';
  iat: number;
  exp: number;
}

interface AdminTokenPayload {
  sub: string; // userId
  orgId: string; // organizationId
  email: string;
  roles: string[];
  permissions: string[];
  sid: string; // sessionId
  type: 'admin';
  iat: number;
  exp: number;
}

type TokenPayload = WorkerTokenPayload | AdminTokenPayload;

const DEFAULT_WORKER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_ADMIN_SESSION_TTL_SECONDS = 24 * 60 * 60; // 1 day

@Injectable()
export class SessionService {
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('SESSION_SECRET') ?? process.env.SESSION_SECRET;
    if (!secret || secret.length < 16) {
      throw new Error('SESSION_SECRET environment variable is missing or insufficiently secure (min 16 chars).');
    }
    this.secret = secret;
  }

  /**
   * Generates a tamper-proof HMAC-signed worker session token.
   */
  createWorkerToken(
    params: {
      employeeId: string;
      organizationId: string;
      telegramUserId: string;
      ttlSeconds?: number;
    },
    now = new Date(),
  ): { token: string; expiresAt: Date; sessionId: string } {
    const ttl = params.ttlSeconds ?? DEFAULT_WORKER_SESSION_TTL_SECONDS;
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const expiresEpoch = nowEpoch + ttl;
    const sessionId = randomUUID();

    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: WorkerTokenPayload = {
      sub: params.employeeId,
      orgId: params.organizationId,
      tgId: params.telegramUserId,
      sid: sessionId,
      type: 'worker',
      iat: nowEpoch,
      exp: expiresEpoch,
    };

    return this.signPayload(header, payload, expiresEpoch);
  }

  /**
   * Generates a tamper-proof HMAC-signed admin session token.
   */
  createAdminToken(
    params: {
      userId: string;
      organizationId: string;
      email: string;
      roles: string[];
      permissions?: string[];
      ttlSeconds?: number;
    },
    now = new Date(),
  ): { token: string; expiresAt: Date; sessionId: string } {
    const ttl = params.ttlSeconds ?? DEFAULT_ADMIN_SESSION_TTL_SECONDS;
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const expiresEpoch = nowEpoch + ttl;
    const sessionId = randomUUID();

    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: AdminTokenPayload = {
      sub: params.userId,
      orgId: params.organizationId,
      email: params.email,
      roles: params.roles,
      permissions: params.permissions ?? [],
      sid: sessionId,
      type: 'admin',
      iat: nowEpoch,
      exp: expiresEpoch,
    };

    return this.signPayload(header, payload, expiresEpoch);
  }

  private signPayload(
    header: Record<string, unknown>,
    payload: TokenPayload,
    expiresEpoch: number,
  ): { token: string; expiresAt: Date; sessionId: string } {
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const dataToSign = `${headerB64}.${payloadB64}`;
    const signature = createHmac('sha256', this.secret).update(dataToSign).digest('base64url');

    const token = `${dataToSign}.${signature}`;
    const expiresAt = new Date(expiresEpoch * 1000);

    return { token, expiresAt, sessionId: payload.sid };
  }

  /**
   * Verifies and decodes any principal token (Worker or Admin).
   */
  verifyToken(token: string, now = new Date()): Principal {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    const [headerB64, payloadB64, signature] = parts;
    if (!headerB64 || !payloadB64 || !signature) {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    const dataToSign = `${headerB64}.${payloadB64}`;
    const expectedSignature = createHmac('sha256', this.secret).update(dataToSign).digest('base64url');

    const expectedBuf = Buffer.from(expectedSignature);
    const actualBuf = Buffer.from(signature);

    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    if (!payload || !payload.sub || !payload.orgId || !payload.sid || typeof payload.exp !== 'number') {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    const nowEpoch = Math.floor(now.getTime() / 1000);
    if (payload.exp <= nowEpoch) {
      throw new UnauthorizedException('SESSION_EXPIRED');
    }

    if (payload.type === 'worker') {
      const workerPayload = payload as WorkerTokenPayload;
      if (!workerPayload.tgId) {
        throw new UnauthorizedException('INVALID_SESSION');
      }
      return {
        type: 'worker',
        organizationId: workerPayload.orgId,
        employeeId: workerPayload.sub,
        telegramUserId: workerPayload.tgId,
        sessionId: workerPayload.sid,
      };
    }

    if (payload.type === 'admin') {
      const adminPayload = payload as AdminTokenPayload;
      if (!adminPayload.email || !Array.isArray(adminPayload.roles)) {
        throw new UnauthorizedException('INVALID_SESSION');
      }
      return {
        type: 'admin',
        organizationId: adminPayload.orgId,
        userId: adminPayload.sub,
        email: adminPayload.email,
        roles: adminPayload.roles,
        permissions: adminPayload.permissions ?? [],
      };
    }

    throw new UnauthorizedException('INVALID_SESSION');
  }

  /**
   * Backward-compatible verify worker token.
   */
  verifyWorkerToken(token: string, now = new Date()): WorkerPrincipal {
    const principal = this.verifyToken(token, now);
    if (principal.type !== 'worker') {
      throw new UnauthorizedException('INVALID_SESSION');
    }
    return principal;
  }
}

