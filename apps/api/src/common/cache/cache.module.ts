import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { CACHE_REDIS, CacheService, cacheDeadlineMs } from './cache.service.js';

export function createCacheRedis(config: ConfigService): Redis | null {
  const url = config.get<string>('REDIS_URL');
  if (!url) return null;
  try {
    const client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: (attempt) => Math.min(30_000, attempt * 1_000),
      reconnectOnError: () => false,
      autoResendUnfulfilledCommands: false,
      connectTimeout: 100,
      commandTimeout: cacheDeadlineMs(config),
    });
    client.on('error', () => undefined);
    // Startup never waits for Redis; HTTP only uses an already-ready connection.
    void client.connect().catch(() => undefined);
    return client;
  } catch {
    return null;
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    { provide: CACHE_REDIS, inject: [ConfigService], useFactory: createCacheRedis },
    CacheService,
  ],
  exports: [CacheService],
})
export class CacheModule {}
