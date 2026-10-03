import { ForbiddenException, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TelegramSessionResponse } from '@workforce/contracts';
import { SessionService } from '../auth/session.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramInitDataVerifier } from './telegram-init-data.verifier.js';
import { CacheService } from '../common/cache/cache.service.js';
import { startStep, timeStep } from '../common/performance/request-timing.js';

const SESSION_CACHE_TTL_MS = 15_000;
const accountSelect = {
  id: true, organizationId: true, employeeId: true, telegramUserId: true, status: true,
  employee: { select: {
    id: true, organizationId: true, employeeCode: true, fullName: true, avatarUrl: true, status: true,
    currentPosition: { select: { id: true, code: true, name: true } },
  } },
  organization: { select: { id: true, name: true, slug: true } },
} as const;

type SessionAccount = {
  id: string; organizationId: string; employeeId: string; telegramUserId: string; status: string;
  employee: {
    id: string; organizationId: string; employeeCode: string; fullName: string;
    avatarUrl: string | null; status: string;
    currentPosition: { id: string; code: string; name: string } | null;
  };
  organization: { id: string; name: string; slug: string };
};

type AccountRow = Pick<SessionAccount, 'id' | 'organizationId' | 'employeeId' | 'telegramUserId' | 'status'> & {
  emp_id: string; emp_organizationId: string; emp_employeeCode: string; emp_fullName: string;
  emp_avatarUrl: string | null; emp_status: string;
  pos_id: string | null; pos_code: string; pos_name: string;
  org_id: string; org_name: string; org_slug: string;
};

@Injectable()
export class TelegramSessionService {
  private readonly logger = new Logger(TelegramSessionService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly verifier: TelegramInitDataVerifier,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  async createSession(initData: string): Promise<TelegramSessionResponse> {
    return timeStep('session', () => this.resolveSession(initData));
  }

  private async resolveSession(initData: string): Promise<TelegramSessionResponse> {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      this.logger.error('TELEGRAM_BOT_TOKEN is not configured on the server.');
      throw new UnauthorizedException('TELEGRAM_AUTH_NOT_CONFIGURED');
    }

    // 1. Verify Telegram HMAC and extract verified user details
    const stopValidation = startStep('telegram_validation');
    const verifiedUser = (() => {
      try { return this.verifier.verify(initData, botToken); }
      catch (error) { stopValidation(true); throw error; }
      finally { stopValidation(); }
    })();

    // HMAC verification above is intentionally outside all cache/coalescing work.
    let freshResolution = false;
    let account = await this.resolveAccount(verifiedUser.id, botToken.split(':')[0], () => {
      freshResolution = true;
    });

    if (!account) {
      const owner = typeof this.prisma.telegramOrganizationOwner?.findFirst === 'function'
        ? await this.prisma.telegramOrganizationOwner.findFirst({
            where: { telegramUserId: verifiedUser.id, pairedAt: { not: null } },
            include: { organization: true },
          })
        : null;
      if (owner) {
        freshResolution = true;
        let employee = await this.prisma.employee.findFirst({
          where: { organizationId: owner.organizationId, telegramAccount: { telegramUserId: verifiedUser.id } },
          include: { organization: true, currentPosition: true },
        });
        if (!employee) {
          const fullName = [verifiedUser.firstName, verifiedUser.lastName].filter(Boolean).join(' ') || verifiedUser.username || 'Owner';
          employee = await this.prisma.employee.create({
            data: {
              organizationId: owner.organizationId,
              employeeCode: `OWN-${Math.floor(100000 + Math.random() * 900000)}`,
              fullName,
              phone: '',
              status: 'ACTIVE',
            },
            include: { organization: true, currentPosition: true },
          });
        }
        account = await this.prisma.telegramAccount.upsert({
          where: { employeeId: employee.id },
          create: {
            organizationId: owner.organizationId,
            employeeId: employee.id,
            telegramUserId: verifiedUser.id,
            username: verifiedUser.username,
            firstName: verifiedUser.firstName,
            lastName: verifiedUser.lastName,
            status: 'ACTIVE',
          },
          update: {
            telegramUserId: verifiedUser.id,
            username: verifiedUser.username,
            firstName: verifiedUser.firstName,
            lastName: verifiedUser.lastName,
            status: 'ACTIVE',
          },
          select: accountSelect,
        });
      }
    }

    if (!account) {
      const pendingReq = await this.prisma.registrationRequest?.findFirst({
        where: { telegramUserId: verifiedUser.id, status: 'PENDING' },
      });
      if (pendingReq) {
        throw new ForbiddenException('REGISTRATION_PENDING');
      }
      throw new UnauthorizedException('TELEGRAM_UNLINKED');
    }

    this.validateAccount(account, verifiedUser.id);

    // Profile synchronization is best-effort only after a DB resolution. Warm
    // sessions verify HMAC and mint a token without any database reads or writes.
    const avatarToSync = verifiedUser.photoUrl && !account.employee.avatarUrl ? verifiedUser.photoUrl : null;
    if (freshResolution) void (async () => {
      try {
        if (typeof this.prisma.telegramAccount?.update === 'function') {
          await this.prisma.telegramAccount.update({
            where: { id: account.id, organizationId: account.organizationId, telegramUserId: verifiedUser.id },
            data: {
              lastVerifiedAt: new Date(),
              username: verifiedUser.username,
              firstName: verifiedUser.firstName,
              lastName: verifiedUser.lastName,
              photoUrl: verifiedUser.photoUrl,
            },
          });
        }
        if (avatarToSync && typeof this.prisma.employee?.updateMany === 'function') {
          await this.prisma.employee.updateMany({
            where: { id: account.employee.id, organizationId: account.organizationId, avatarUrl: null },
            data: { avatarUrl: avatarToSync },
          });
        }
      } catch {
        this.logger.warn('Failed to background sync Telegram profile.');
      }
    })();

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
        avatarUrl: account.employee.avatarUrl ?? verifiedUser.photoUrl ?? null,
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

  private validateAccount(account: SessionAccount, telegramUserId: string): void {
    if (account.status !== 'ACTIVE') throw new UnauthorizedException('TELEGRAM_ACCOUNT_INACTIVE');
    if (!account.employee || account.employee.status !== 'ACTIVE') throw new ForbiddenException('EMPLOYEE_INACTIVE');
    if (!account.organization) throw new UnauthorizedException('ORGANIZATION_NOT_FOUND');
    if (account.telegramUserId !== telegramUserId || account.employeeId !== account.employee.id ||
        account.organizationId !== account.employee.organizationId || account.organizationId !== account.organization.id) {
      throw new UnauthorizedException('FORBIDDEN_SCOPE');
    }
  }

  private async resolveAccount(
    telegramUserId: string, botId: string, onDatabaseLoad: () => void,
  ): Promise<SessionAccount | null> {
    let loaded: SessionAccount | null | undefined;
    const load = async () => {
      const accounts = await this.loadAccounts(telegramUserId);
      onDatabaseLoad();
      if (accounts.length > 1) throw new ForbiddenException('TELEGRAM_ACCOUNT_AMBIGUOUS');
      loaded = accounts[0] ?? null;
      if (loaded) this.validateAccount(loaded, telegramUserId);
      return loaded;
    };
    if (!this.cache) return load();

    const prefix = `telegram-session:${botId}:${telegramUserId}`;
    // The session endpoint has no trusted tenant until discovery. This index
    // holds only identity pointers; all profile data lives under a tenant key.
    const scope = await this.cache.getOrLoad({ prefix, key: 'scope' }, SESSION_CACHE_TTL_MS, async () => {
      const resolvedAt = Date.now();
      const account = await load();
      return account ? {
        organizationId: account.organizationId, employeeId: account.employeeId, accountId: account.id, resolvedAt,
      } : null;
    });
    if (!scope) return null;
    if (Date.now() >= scope.resolvedAt + SESSION_CACHE_TTL_MS) return load();
    const account = await this.cache.getOrLoad({
      prefix, key: JSON.stringify(['account', scope.organizationId, scope.employeeId, telegramUserId, scope.resolvedAt]),
    }, SESSION_CACHE_TTL_MS, async () => {
      const current = loaded ?? await load();
      if (current && (current.id !== scope.accountId || current.organizationId !== scope.organizationId ||
          current.employeeId !== scope.employeeId)) throw new UnauthorizedException('TELEGRAM_SESSION_SCOPE_CHANGED');
      return current;
    });
    if (Date.now() >= scope.resolvedAt + SESSION_CACHE_TTL_MS) return load();
    if (account) {
      this.validateAccount(account, telegramUserId);
      if (account.id !== scope.accountId || account.organizationId !== scope.organizationId ||
          account.employeeId !== scope.employeeId) throw new UnauthorizedException('FORBIDDEN_SCOPE');
    }
    return account;
  }

  private async loadAccounts(telegramUserId: string): Promise<SessionAccount[]> {
    if (typeof this.prisma.$queryRaw !== 'function') {
      return this.prisma.telegramAccount.findMany({
        where: { telegramUserId, status: 'ACTIVE' }, take: 2, select: accountSelect,
      });
    }
    // Single round trip. The verified Telegram identity is the sole discovery
    // selector; every joined tenant-owned relation must match the account tenant.
    const rows = await this.prisma.$queryRaw<AccountRow[]>`
      SELECT ta.id, ta."organizationId", ta."employeeId", ta."telegramUserId", ta.status,
        e.id AS emp_id, e."organizationId" AS "emp_organizationId",
        e."employeeCode" AS "emp_employeeCode", e."fullName" AS "emp_fullName",
        e."avatarUrl" AS "emp_avatarUrl", e.status AS emp_status,
        p.id AS pos_id, p.code AS pos_code, p.name AS pos_name,
        o.id AS org_id, o.name AS org_name, o.slug AS org_slug
      FROM "TelegramAccount" ta
      JOIN "Employee" e ON e.id = ta."employeeId" AND e."organizationId" = ta."organizationId"
      JOIN "Organization" o ON o.id = ta."organizationId"
      LEFT JOIN "Position" p ON p.id = e."currentPositionId" AND p."organizationId" = ta."organizationId"
      WHERE ta."telegramUserId" = ${telegramUserId} AND ta.status = 'ACTIVE'::"LifecycleStatus"
      LIMIT 2
    `;
    return rows.map((r) => ({
      id: r.id, organizationId: r.organizationId, employeeId: r.employeeId,
      telegramUserId: r.telegramUserId, status: r.status,
      employee: {
        id: r.emp_id, organizationId: r.emp_organizationId, employeeCode: r.emp_employeeCode,
        fullName: r.emp_fullName, avatarUrl: r.emp_avatarUrl, status: r.emp_status,
        currentPosition: r.pos_id ? { id: r.pos_id, code: r.pos_code, name: r.pos_name } : null,
      },
      organization: { id: r.org_id, name: r.org_name, slug: r.org_slug },
    }));
  }
}
