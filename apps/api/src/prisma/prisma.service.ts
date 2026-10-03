import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { prismaQueryTiming } from '../common/performance/prisma-query-timing.js';
import { poolWarmupQueries, warmReadPool } from './pool-warmup.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Prisma error events may include SQL/arguments. Request telemetry retains counts only.
    super({ log: [] });
    return this.$extends(prismaQueryTiming) as this;
  }

  async onModuleInit(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || databaseUrl.includes('[DB_PASSWORD]')) {
      this.logger.warn('DATABASE_URL is not configured or contains placeholder; skipping database connection on init.');
      return;
    }

    try {
      await this.$connect();
      this.logger.log('Connected to PostgreSQL via Prisma.');
    } catch {
      this.logger.error('Failed to connect to database on init.');
      return;
    }

    const queries = poolWarmupQueries(databaseUrl, process.env.DATABASE_WARMUP_QUERIES);
    if (queries > 0) {
      const startedAt = performance.now();
      try {
        await warmReadPool(() => this.$queryRaw`SELECT 1`, queries);
        this.logger.log(`Database startup warmup completed: ${queries} read probes in ${Math.round(performance.now() - startedAt)}ms.`);
      } catch {
        // Preserve the existing availability policy, without logging database URLs/errors.
        this.logger.warn('Database startup warmup incomplete; first requests may need cold connections.');
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Helper that returns a scoped query object requiring organizationId
   * to guarantee multi-tenant safety.
   */
  forOrganization(organizationId: string) {
    if (!organizationId) {
      throw new Error('Organization ID is required for scoped operations.');
    }
    return {
      organizationId,
      telegramAccounts: {
        findUnique: (args: { where: { telegramUserId: string } }) =>
          this.telegramAccount.findFirst({
            where: {
              telegramUserId: args.where.telegramUserId,
              organizationId,
            },
            include: {
              employee: true,
              organization: true,
            },
          }),
        findActiveByTelegramUserId: (telegramUserId: string) =>
          this.telegramAccount.findFirst({
            where: {
              telegramUserId,
              organizationId,
              status: 'ACTIVE',
            },
            include: {
              employee: true,
              organization: true,
            },
          }),
      },
      employees: {
        findById: (id: string) =>
          this.employee.findFirst({
            where: { id, organizationId },
          }),
        findByCode: (employeeCode: string) =>
          this.employee.findFirst({
            where: { employeeCode, organizationId },
          }),
      },
    };
  }
}
