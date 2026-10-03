import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../src/auth/session.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { TelegramInitDataVerifier } from '../src/telegram/telegram-init-data.verifier.js';
import { TelegramSessionController } from '../src/telegram/telegram-session.controller.js';
import { TelegramSessionService } from '../src/telegram/telegram-session.service.js';

function generateInitData(
  botToken: string,
  user: { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string },
  authDate = Math.floor(Date.now() / 1000),
): string {
  const params: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohD9Kq4-',
    user: JSON.stringify(user),
  };

  const dataCheckString = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const searchParams = new URLSearchParams(params);
  searchParams.set('hash', hash);
  return searchParams.toString();
}

describe('TelegramSessionService and Controller', () => {
  const botToken = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';
  const sessionSecret = 'a-super-secret-key-that-is-very-secure-32chars!';

  let configService: ConfigService;
  let verifier: TelegramInitDataVerifier;
  let sessionService: SessionService;
  let mockPrisma: any;
  let telegramSessionService: TelegramSessionService;
  let controller: TelegramSessionController;

  beforeEach(() => {
    configService = {
      get: vi.fn((key: string) => {
        if (key === 'TELEGRAM_BOT_TOKEN') return botToken;
        if (key === 'SESSION_SECRET') return sessionSecret;
        return undefined;
      }),
    } as unknown as ConfigService;

    verifier = new TelegramInitDataVerifier();
    sessionService = new SessionService(configService);

    mockPrisma = {
      telegramAccount: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      employee: {
        updateMany: vi.fn(),
      },
      registrationRequest: {
        findFirst: vi.fn(),
      },
    };

    telegramSessionService = new TelegramSessionService(
      configService,
      verifier,
      mockPrisma as unknown as PrismaService,
      sessionService,
    );

    controller = new TelegramSessionController(telegramSessionService);
  });

  it('resolves active linked employee and creates safe worker session', async () => {
    const initData = generateInitData(botToken, {
      id: 123456,
      first_name: 'Alice',
      photo_url: 'https://t.me/i/userpic/alice.jpg',
    });

    mockPrisma.telegramAccount.findMany.mockResolvedValue([{
      id: 'tg-acc-1',
      organizationId: 'org-abc',
      employeeId: 'emp-xyz',
      telegramUserId: '123456',
      status: 'ACTIVE',
      employee: {
        id: 'emp-xyz',
        organizationId: 'org-abc',
        employeeCode: 'EMP-001',
        fullName: 'Alice Worker',
        status: 'ACTIVE',
        avatarUrl: null,
      },
      organization: {
        id: 'org-abc',
        name: 'Acme Construction',
        slug: 'acme-construction',
      },
    }]);

    mockPrisma.telegramAccount.update.mockResolvedValue({});
    mockPrisma.employee.updateMany.mockResolvedValue({});

    const result = await controller.createSession({ initData });

    expect(result.token).toBeDefined();
    expect(result.expiresAt).toBeDefined();
    expect(result.employee).toEqual({
      id: 'emp-xyz',
      employeeCode: 'EMP-001',
      fullName: 'Alice Worker',
      avatarUrl: 'https://t.me/i/userpic/alice.jpg',
      currentPosition: null,
    });
    expect(result.organization).toEqual({
      id: 'org-abc',
      name: 'Acme Construction',
      slug: 'acme-construction',
    });

    // Verifies worker session token decodes back to correct worker principal
    const decoded = sessionService.verifyWorkerToken(result.token);
    expect(decoded.employeeId).toBe('emp-xyz');
    expect(decoded.organizationId).toBe('org-abc');
    expect(decoded.telegramUserId).toBe('123456');

    // Verifies lastVerifiedAt was updated
    expect(mockPrisma.telegramAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tg-acc-1', organizationId: 'org-abc', telegramUserId: '123456' },
      }),
    );
  });

  it('rejects unlinked Telegram user who has no database record', async () => {
    const initData = generateInitData(botToken, { id: 999999 });
    mockPrisma.telegramAccount.findMany.mockResolvedValue([]);

    await expect(telegramSessionService.createSession(initData)).rejects.toThrow(
      new UnauthorizedException('TELEGRAM_UNLINKED'),
    );
  });

  it('rejects when telegram account status is INACTIVE', async () => {
    const initData = generateInitData(botToken, { id: 123456 });
    mockPrisma.telegramAccount.findMany.mockResolvedValue([{
      id: 'tg-acc-1',
      status: 'INACTIVE',
      employee: { status: 'ACTIVE' },
      organization: { id: 'org-1' },
    }]);

    await expect(telegramSessionService.createSession(initData)).rejects.toThrow(
      new UnauthorizedException('TELEGRAM_ACCOUNT_INACTIVE'),
    );
  });

  it('rejects when employee status is INACTIVE with EMPLOYEE_INACTIVE code', async () => {
    const initData = generateInitData(botToken, { id: 123456 });
    mockPrisma.telegramAccount.findMany.mockResolvedValue([{
      id: 'tg-acc-1',
      organizationId: 'org-abc',
      employeeId: 'emp-xyz',
      telegramUserId: '123456',
      status: 'ACTIVE',
      employee: {
        id: 'emp-xyz',
        status: 'INACTIVE',
      },
      organization: {
        id: 'org-abc',
      },
    }]);

    await expect(telegramSessionService.createSession(initData)).rejects.toThrow(
      new ForbiddenException('EMPLOYEE_INACTIVE'),
    );
  });

  it('rejects stale Telegram data before database lookup', async () => {
    const staleAuthDate = Math.floor(Date.now() / 1000) - 86_500;
    const initData = generateInitData(botToken, { id: 123456 }, staleAuthDate);

    await expect(telegramSessionService.createSession(initData)).rejects.toThrow(
      new UnauthorizedException('TELEGRAM_INVALID'),
    );
    expect(mockPrisma.telegramAccount.findMany).not.toHaveBeenCalled();
  });

  it('rejects forged Telegram data before database lookup', async () => {
    const initData = generateInitData(botToken, { id: 123456 });
    const forged = initData.replace('hash=', 'hash=00000000000000000000');

    await expect(telegramSessionService.createSession(forged)).rejects.toThrow(
      new UnauthorizedException('TELEGRAM_INVALID'),
    );
    expect(mockPrisma.telegramAccount.findMany).not.toHaveBeenCalled();
  });

  it('rejects if TELEGRAM_BOT_TOKEN is not configured', async () => {
    const emptyConfig = {
      get: () => undefined,
    } as unknown as ConfigService;

    const noTokenService = new TelegramSessionService(
      emptyConfig,
      verifier,
      mockPrisma as unknown as PrismaService,
      sessionService,
    );

    const initData = generateInitData(botToken, { id: 123456 });
    await expect(noTokenService.createSession(initData)).rejects.toThrow(
      new UnauthorizedException('TELEGRAM_AUTH_NOT_CONFIGURED'),
    );
  });

  it('validates controller request payload format and rejects empty or invalid body', async () => {
    await expect(controller.createSession({})).rejects.toThrow(BadRequestException);
    await expect(controller.createSession({ initData: '' })).rejects.toThrow(BadRequestException);
    await expect(controller.createSession(null)).rejects.toThrow(BadRequestException);
  });
});
