import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TelegramSessionResponse } from '@workforce/contracts';
import { SessionService } from '../auth/session.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramInitDataVerifier } from './telegram-init-data.verifier.js';

@Injectable()
export class TelegramSessionService {
  private readonly logger = new Logger(TelegramSessionService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly verifier: TelegramInitDataVerifier,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {}

  async createSession(initData: string): Promise<TelegramSessionResponse> {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      this.logger.error('TELEGRAM_BOT_TOKEN is not configured on the server.');
      throw new UnauthorizedException('TELEGRAM_AUTH_NOT_CONFIGURED');
    }

    // 1. Verify Telegram HMAC and extract verified user details
    const verifiedUser = this.verifier.verify(initData, botToken);

    // 2. Resolve linked Telegram account
    const account = await this.prisma.telegramAccount.findUnique({
      where: { telegramUserId: verifiedUser.id },
      include: {
        employee: {
          include: {
            currentPosition: true,
          },
        },
        organization: true,
      },
    });

    if (!account) {
      const pendingReq = await this.prisma.registrationRequest.findFirst({
        where: { telegramUserId: verifiedUser.id, status: 'PENDING' },
      });
      if (pendingReq) {
        throw new ForbiddenException('REGISTRATION_PENDING');
      }
      throw new UnauthorizedException('TELEGRAM_UNLINKED');
    }

    // 3. Verify Telegram account status
    if (account.status !== 'ACTIVE') {
      throw new UnauthorizedException('TELEGRAM_ACCOUNT_INACTIVE');
    }

    // 4. Verify Employee status
    if (!account.employee || account.employee.status !== 'ACTIVE') {
      throw new ForbiddenException('EMPLOYEE_INACTIVE');
    }

    // 5. Verify Organization status
    if (!account.organization) {
      throw new UnauthorizedException('ORGANIZATION_NOT_FOUND');
    }

    // 6. Persist verified Telegram profile metadata (avatar photo, username, names)
    await this.prisma.telegramAccount.update({
      where: { id: account.id },
      data: {
        lastVerifiedAt: new Date(),
        username: verifiedUser.username ?? account.username,
        firstName: verifiedUser.firstName ?? account.firstName,
        lastName: verifiedUser.lastName ?? account.lastName,
        photoUrl: verifiedUser.photoUrl ?? account.photoUrl,
      },
    });

    // If worker profile avatar is not set, sync from verified Telegram photo
    let avatarUrl = account.employee.avatarUrl;
    if (verifiedUser.photoUrl && !avatarUrl) {
      await this.prisma.employee.update({
        where: { id: account.employee.id },
        data: { avatarUrl: verifiedUser.photoUrl },
      });
      avatarUrl = verifiedUser.photoUrl;
    }

    // 7. Issue safe worker session
    const session = this.sessionService.createWorkerToken({
      employeeId: account.employee.id,
      organizationId: account.organizationId,
      telegramUserId: account.telegramUserId,
    });

    return {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      employee: {
        id: account.employee.id,
        employeeCode: account.employee.employeeCode,
        fullName: account.employee.fullName,
        avatarUrl: avatarUrl ?? verifiedUser.photoUrl ?? null,
        currentPosition: account.employee.currentPosition
          ? {
              id: account.employee.currentPosition.id,
              code: account.employee.currentPosition.code,
              name: account.employee.currentPosition.name,
            }
          : null,
      },
      organization: {
        id: account.organization.id,
        name: account.organization.name,
        slug: account.organization.slug,
      },
    };
  }
}
