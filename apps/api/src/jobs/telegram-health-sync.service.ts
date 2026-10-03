import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

const DEFAULT_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const TELEGRAM_HEALTH_TIMEOUT_MS = 8_000;

@Injectable()
export class TelegramHealthSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramHealthSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const enabled = this.config.get<string>('TELEGRAM_HEALTH_SYNC_ENABLED') === 'true';
    if (!enabled) return;

    const configuredInterval = Number(this.config.get<string>('TELEGRAM_HEALTH_SYNC_INTERVAL_MS'));
    const intervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 60_000
      ? configuredInterval
      : DEFAULT_SYNC_INTERVAL_MS;

    this.timer = setInterval(() => void this.syncAll(), intervalMs);
    this.timer.unref();
    void this.syncAll();
    this.logger.log(`Telegram health sync enabled with ${intervalMs}ms interval.`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async syncAll() {
    if (this.running) return;
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('Telegram health sync skipped because TELEGRAM_BOT_TOKEN is missing.');
      return;
    }

    this.running = true;
    try {
      const projects = await this.prisma.project.findMany({
        where: { telegramChatId: { not: null }, status: { not: 'ARCHIVED' } },
        select: { id: true, organizationId: true, telegramChatId: true },
      });

      const concurrency = 4;
      for (let index = 0; index < projects.length; index += concurrency) {
        const batch = projects.slice(index, index + concurrency);
        await Promise.all(batch.map(async (project) => {
          let connectionStatus = 'PERMISSION_ERROR';
          let healthError: string | null = null;
          let timeout: NodeJS.Timeout | undefined;
          try {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), TELEGRAM_HEALTH_TIMEOUT_MS);
            const response = await fetch(
              `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(project.telegramChatId!)}`,
              { signal: controller.signal },
            );
            const payload = await response.json() as { ok?: boolean; description?: string };
            if (payload.ok) connectionStatus = 'CONNECTED';
            else {
              healthError = payload.description ?? `HTTP_${response.status}`;
              connectionStatus = /kicked|chat not found|not a member/i.test(healthError)
                ? 'BOT_REMOVED'
                : 'PERMISSION_ERROR';
            }
          } catch (reason) {
            healthError = reason instanceof Error ? reason.message : 'TELEGRAM_HEALTH_CHECK_FAILED';
          } finally {
            if (timeout) clearTimeout(timeout);
          }

          const checkedAt = new Date();
          await this.prisma.$transaction([
            this.prisma.project.update({
              where: { id: project.id },
              data: {
                telegramConnectionStatus: connectionStatus,
                telegramHealthCheckedAt: checkedAt,
                telegramHealthError: healthError,
              },
            }),
            this.prisma.auditLog.create({
              data: {
                organizationId: project.organizationId,
                action: 'TELEGRAM_CONNECTION_HEALTH_SYNCED',
                targetType: 'Project',
                targetId: project.id,
                metadata: { connectionStatus, healthError },
              },
            }),
          ]);
        }));
      }
    } finally {
      this.running = false;
    }
  }
}
