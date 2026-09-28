import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { SessionService } from '../src/auth/session.service.js';

describe('SessionService', () => {
  const secret = 'test-secret-key-that-is-at-least-32-characters-long!';
  const configService = {
    get: (key: string) => (key === 'SESSION_SECRET' ? secret : undefined),
  } as unknown as ConfigService;

  const sessionService = new SessionService(configService);

  it('issues a valid worker session token and successfully verifies it', () => {
    const { token, expiresAt, sessionId } = sessionService.createWorkerToken({
      employeeId: 'emp-123',
      organizationId: 'org-456',
      telegramUserId: 'tg-789',
      ttlSeconds: 3600,
    });

    expect(token).toBeDefined();
    expect(sessionId).toBeDefined();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const principal = sessionService.verifyWorkerToken(token);
    expect(principal).toEqual({
      type: 'worker',
      employeeId: 'emp-123',
      organizationId: 'org-456',
      telegramUserId: 'tg-789',
      sessionId,
    });
  });

  it('rejects a token with a forged or tampered signature', () => {
    const { token } = sessionService.createWorkerToken({
      employeeId: 'emp-123',
      organizationId: 'org-456',
      telegramUserId: 'tg-789',
    });

    const parts = token.split('.');
    parts[2] = 'forged_signature_value';
    const tamperedToken = parts.join('.');

    expect(() => sessionService.verifyWorkerToken(tamperedToken)).toThrow(UnauthorizedException);
    expect(() => sessionService.verifyWorkerToken(tamperedToken)).toThrow('INVALID_SESSION');
  });

  it('rejects a token when the payload has been modified', () => {
    const { token } = sessionService.createWorkerToken({
      employeeId: 'emp-123',
      organizationId: 'org-456',
      telegramUserId: 'tg-789',
    });

    const parts = token.split('.');
    const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    decodedPayload.sub = 'attacker-emp-id';
    parts[1] = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
    const tamperedToken = parts.join('.');

    expect(() => sessionService.verifyWorkerToken(tamperedToken)).toThrow(UnauthorizedException);
    expect(() => sessionService.verifyWorkerToken(tamperedToken)).toThrow('INVALID_SESSION');
  });

  it('rejects an expired token', () => {
    const past = new Date(Date.now() - 100_000);
    const { token } = sessionService.createWorkerToken(
      {
        employeeId: 'emp-123',
        organizationId: 'org-456',
        telegramUserId: 'tg-789',
        ttlSeconds: 60,
      },
      past,
    );

    expect(() => sessionService.verifyWorkerToken(token, new Date())).toThrow(UnauthorizedException);
    expect(() => sessionService.verifyWorkerToken(token, new Date())).toThrow('SESSION_EXPIRED');
  });

  it('rejects malformed tokens', () => {
    expect(() => sessionService.verifyWorkerToken('not-a-token')).toThrow(UnauthorizedException);
    expect(() => sessionService.verifyWorkerToken('')).toThrow(UnauthorizedException);
    expect(() => sessionService.verifyWorkerToken('header.payload')).toThrow(UnauthorizedException);
  });
});
