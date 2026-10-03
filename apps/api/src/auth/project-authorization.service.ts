import { ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerPrincipal } from './principal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../common/cache/cache.service.js';
import { timeStep } from '../common/performance/request-timing.js';
import { isVerifiedWorker } from './verified-worker.js';

export interface ResolvedProjectAccess {
  project: { id: string; organizationId: string; name: string; status: string; telegramChatId: string | null; workMode: string };
  connection: { id: string; organizationId: string; employeeId: string; projectId: string; authorizationStatus?: string } | null;
}

export type ProjectAccessSource =
  | 'BOT_BUTTON'
  | 'MINI_APP_SWITCH'
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'VISIT'
  | 'REGISTRATION'
  | 'SALES_DAY'
  | 'SALES_OUTLET'
  | 'SALES_REPORT';

interface MembershipResult {
  authorized: boolean;
  result: string;
  connectionStatus?: 'CONNECTED' | 'BOT_REMOVED' | 'PERMISSION_ERROR';
  detail?: string;
}

@Injectable()
export class ProjectAuthorizationService {
  private readonly logger = new Logger(ProjectAuthorizationService.name);
  private readonly membershipCache = new Map<string, { expiresAt: number; result: MembershipResult }>();
  private readonly membershipCacheTtlMs = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  async verifyTelegramMembership(chatId: string, telegramUserId: string): Promise<MembershipResult> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return { authorized: false, result: 'TELEGRAM_NOT_CONFIGURED', connectionStatus: 'PERMISSION_ERROR' };
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(telegramUserId)}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        description?: string;
        result?: { status?: string; is_member?: boolean };
      };

      if (!payload.ok) {
        const detail = payload.description ?? `HTTP_${response.status}`;
        const botRemoved = /bot was kicked|chat not found|bot is not a member/i.test(detail);
        return {
          authorized: false,
          result: botRemoved ? 'BOT_REMOVED' : 'MEMBERSHIP_CHECK_FAILED',
          connectionStatus: botRemoved ? 'BOT_REMOVED' : 'PERMISSION_ERROR',
          detail,
        };
      }

      const status = payload.result?.status;
      const authorized =
        status === 'creator' ||
        status === 'administrator' ||
        status === 'member' ||
        (status === 'restricted' && payload.result?.is_member === true);

      return {
        authorized,
        result: authorized ? `MEMBER_${status?.toUpperCase()}` : `NOT_MEMBER_${status?.toUpperCase() ?? 'UNKNOWN'}`,
        connectionStatus: 'CONNECTED',
      };
    } catch (error) {
      const detail = error instanceof Error && /Timeout|Abort/.test(error.name) ? 'TELEGRAM_MEMBERSHIP_TIMEOUT' : 'TELEGRAM_MEMBERSHIP_NETWORK_ERROR';
      this.logger.warn(detail);
      return { authorized: false, result: 'MEMBERSHIP_CHECK_FAILED', connectionStatus: 'PERMISSION_ERROR', detail };
    }
  }

  async authorizeWorkerProject(
    principal: WorkerPrincipal,
    projectId: string,
    source: ProjectAccessSource,
    requireExistingConnection = true,
    resolved?: ResolvedProjectAccess,
  ) {
    if (resolved && (resolved.project.organizationId !== principal.organizationId || resolved.project.id !== projectId ||
      (resolved.connection && (resolved.connection.organizationId !== principal.organizationId || resolved.connection.employeeId !== principal.employeeId || resolved.connection.projectId !== projectId)))) {
      throw new ForbiddenException('FORBIDDEN_SCOPE');
    }
    const [project, account, connection] = await Promise.all([
      resolved ? Promise.resolve(resolved.project) : this.prisma.project.findFirst({
        where: { id: projectId, organizationId: principal.organizationId },
      }),
      isVerifiedWorker(principal) ? Promise.resolve(true) : this.prisma.telegramAccount.findFirst({
        where: {
          employeeId: principal.employeeId,
          organizationId: principal.organizationId,
          telegramUserId: principal.telegramUserId,
          status: 'ACTIVE',
          employee: { status: 'ACTIVE' },
        },
        select: { id: true },
      }),
      resolved ? Promise.resolve(resolved.connection) : this.prisma.workerProject.findUnique({
        where: { employeeId_projectId: { employeeId: principal.employeeId, projectId }, organizationId: principal.organizationId },
      }),
    ]);

    if (!project || !project.telegramChatId || project.status !== 'ACTIVE') {
      await this.recordDenied(principal, projectId, source, 'PROJECT_UNAVAILABLE');
      throw new NotFoundException('PROJECT_UNAVAILABLE');
    }
    if (!account) {
      await this.recordDenied(principal, projectId, source, 'WORKER_IDENTITY_INVALID');
      throw new ForbiddenException('WORKER_IDENTITY_INVALID');
    }
    if (requireExistingConnection && !connection) {
      await this.recordDenied(principal, projectId, source, 'PROJECT_NOT_CONNECTED');
      throw new ForbiddenException('PROJECT_NOT_CONNECTED');
    }

    const cacheKey = `${principal.organizationId}:${project.id}:${project.telegramChatId}:${principal.telegramUserId}:${connection?.authorizationStatus ?? ''}`;
    // Bound the fallback cache even when Redis is temporarily unavailable.
    for (const [key, entry] of this.membershipCache) if (entry.expiresAt <= Date.now()) this.membershipCache.delete(key);
    if (this.membershipCache.size >= 2_000) this.membershipCache.delete(this.membershipCache.keys().next().value!);
    const cachedMembership = this.membershipCache.get(cacheKey);
    let isCached = true;
    const verify = async () => {
      isCached = false;
      return timeStep('membership', () => this.verifyTelegramMembership(project.telegramChatId!, principal.telegramUserId));
    };
    const membership = this.cache
      ? await this.cache.getOrLoad({ prefix: `membership:${principal.organizationId}:${project.id}`, key: cacheKey }, this.membershipCacheTtlMs, verify)
      : cachedMembership && cachedMembership.expiresAt > Date.now() ? cachedMembership.result : await verify();
    if (!this.cache && !isCached && membership.authorized) this.membershipCache.set(cacheKey, { expiresAt: Date.now() + this.membershipCacheTtlMs, result: membership });

    const verifiedAt = new Date();

    if (membership.authorized) {
      // If newly verified, persist status asynchronously without blocking worker check-in/reads
      if (!isCached) {
        void this.prisma.project.update({
          where: { id: project.id, organizationId: principal.organizationId },
          data: {
            telegramConnectionStatus: membership.connectionStatus ?? 'CONNECTED',
            telegramHealthCheckedAt: verifiedAt,
            telegramHealthError: null,
          },
        }).catch(() => undefined);

        if (connection) {
          void this.prisma.workerProject.update({
            where: { id: connection.id, organizationId: principal.organizationId, employeeId: principal.employeeId, projectId },
            data: {
              authorizationStatus: 'AUTHORIZED',
              lastVerifiedAt: verifiedAt,
              lastVerificationResult: membership.result,
              revokedAt: null,
            },
          }).catch(() => undefined);
        }
      }

      return { project, connection, verifiedAt, membershipResult: membership.result };
    }

    // Unauthorized: record revocation and audit log synchronously
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: project.id, organizationId: principal.organizationId },
        data: {
          telegramConnectionStatus: membership.connectionStatus ?? 'PERMISSION_ERROR',
          telegramHealthCheckedAt: verifiedAt,
          telegramHealthError: membership.detail ?? membership.result,
        },
      });

      if (connection) {
        await tx.workerProject.update({
          where: { id: connection.id, organizationId: principal.organizationId, employeeId: principal.employeeId, projectId },
          data: {
            authorizationStatus: 'REVOKED',
            lastVerifiedAt: verifiedAt,
            lastVerificationResult: membership.result,
            revokedAt: verifiedAt,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: principal.organizationId,
          action: 'PROJECT_ACCESS_DENIED',
          targetType: 'Project',
          targetId: project.id,
          metadata: {
            employeeId: principal.employeeId,
            telegramUserId: principal.telegramUserId,
            source,
            reason: membership.result,
          },
        },
      });
    });

    throw new ForbiddenException('TELEGRAM_GROUP_MEMBERSHIP_REQUIRED');

  }

  private async recordDenied(
    principal: WorkerPrincipal,
    projectId: string,
    source: ProjectAccessSource,
    reason: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        organizationId: principal.organizationId,
        action: 'PROJECT_ACCESS_DENIED',
        targetType: 'Project',
        targetId: projectId,
        metadata: {
          employeeId: principal.employeeId,
          telegramUserId: principal.telegramUserId,
          source,
          reason,
        },
      },
    });
  }

  /**
   * Ensures the project has an active Site and WorkSchedule, and that the
   * employee has an active Assignment for today so they can record attendance.
   */
  async ensureProjectSiteAndAssignment(
    organizationId: string,
    projectId: string,
    employeeId: string,
  ): Promise<void> {
    try {
      let site = await this.prisma.site.findFirst({
        where: { projectId, organizationId, status: 'ACTIVE' },
      });
      if (!site) {
        const project = await this.prisma.project.findUnique({ where: { id: projectId } });
        site = await this.prisma.site.create({
          data: {
            organizationId,
            projectId,
            name: project?.name || 'Main Site',
            latitude: 11.5564,
            longitude: 104.9282,
            allowedRadiusMeters: 500,
            timezone: 'Asia/Phnom_Penh',
            status: 'ACTIVE',
          },
        });
      }

      let schedule = await this.prisma.workSchedule.findFirst({
        where: { organizationId },
      });
      if (!schedule) {
        schedule = await this.prisma.workSchedule.create({
          data: {
            organizationId,
            name: 'General Shift',
            timezone: 'Asia/Phnom_Penh',
            startTime: '08:00',
            endTime: '17:00',
            graceMinutes: 15,
          },
        });
      }

      const existingAssignment = await this.prisma.assignment.findFirst({
        where: {
          organizationId,
          employeeId,
          siteId: site.id,
          status: 'ACTIVE',
        },
      });
      if (!existingAssignment) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        await this.prisma.assignment.create({
          data: {
            organizationId,
            employeeId,
            siteId: site.id,
            scheduleId: schedule.id,
            startsOn: today,
            endsOn: null,
            status: 'ACTIVE',
          },
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to ensure project site and assignment for project ${projectId}, employee ${employeeId}: ${err.message}`,
      );
    }
  }
}
