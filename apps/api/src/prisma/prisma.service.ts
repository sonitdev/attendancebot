import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
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
    } catch (error) {
      this.logger.error('Failed to connect to database on init', error instanceof Error ? error.stack : error);
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
