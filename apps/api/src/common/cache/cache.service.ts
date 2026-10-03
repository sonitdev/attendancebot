import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export const CACHE_REDIS = Symbol('CACHE_REDIS');
export const MAX_CACHE_TTL_MS = 30_000;
const SERVER_INSTANCE = randomUUID();
const MAX_IN_FLIGHT = 512;
const COALESCE_WINDOW_MS = 1_000;

export interface CacheKey {
  /** Exact invalidation group, not a Redis glob. Include tenant scope where available. */
  prefix: string;
  key: string;
}

export type CacheRedis = Pick<Redis, 'get' | 'set' | 'disconnect' | 'status'>;

export function cacheNamespace(config: ConfigService): string {
  let database: string = SERVER_INSTANCE;
  try {
    const url = new URL(config.get<string>('DATABASE_URL') ?? '');
    // Database identity only: never include credentials in Redis keys or logs.
    database = JSON.stringify([url.host, url.pathname, url.username, url.searchParams.get('schema')]);
  } catch { /* Without a database identity, keep this process isolated. */ }
  const identity = JSON.stringify([
    config.get<string>('CACHE_NAMESPACE') ?? 'attendance-api',
    config.get<string>('NODE_ENV') ?? 'development',
    database,
  ]);
  return `attendance:cache:v1:${createHash('sha256').update(identity).digest('hex')}`;
}

export function cacheDeadlineMs(config: ConfigService): number {
  const configured = Number(config.get('CACHE_REDIS_TIMEOUT_MS') ?? 40);
  return Number.isFinite(configured) ? Math.max(5, Math.min(50, configured)) : 40;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly namespace: string;
  private readonly deadlineMs: number;
  private readonly inFlight = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();
  private bypassUntil = 0;

  constructor(
    config: ConfigService,
    @Optional() @Inject(CACHE_REDIS) private readonly redis?: CacheRedis | null,
  ) {
    this.namespace = cacheNamespace(config);
    this.deadlineMs = cacheDeadlineMs(config);
  }

  /** Shares only pending work. Completed, failed, or old promises are never a local value cache. */
  coalesce<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [entryKey, entry] of this.inFlight) {
      if (entry.expiresAt <= now) this.inFlight.delete(entryKey);
    }
    const existing = this.inFlight.get(key);
    if (existing) return existing.promise as Promise<T>;
    // Saturation bypasses deduplication rather than retaining an unbounded map.
    if (this.inFlight.size >= MAX_IN_FLIGHT) return Promise.resolve().then(loader);
    const promise = Promise.resolve().then(loader);
    this.inFlight.set(key, { expiresAt: now + COALESCE_WINDOW_MS, promise });
    const clear = () => {
      if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key);
    };
    void promise.then(clear, clear);
    return promise;
  }

  getOrLoad<T>(key: CacheKey, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return this.coalesce(JSON.stringify(key), loader);
    const ttl = Math.min(Math.floor(ttlMs), MAX_CACHE_TTL_MS);
    return this.coalesce(JSON.stringify(['redis', key.prefix, key.key, ttl]), async () => {
      const startedAt = Date.now();
      const prefix = `${this.namespace}:${encodeURIComponent(key.prefix)}`;
      const versionResult = await this.command(() => this.redis!.get(`${prefix}:version`));
      const version = versionResult.ok ? versionResult.value ?? '0' : null;
      const valueKey = `${prefix}:${version}:${encodeURIComponent(key.key)}`;
      if (version !== null) {
        const result = await this.command(() => this.redis!.get(valueKey));
        if (result.ok && result.value) {
          try {
            const entry = JSON.parse(result.value) as { expiresAt: number; value: T };
            const now = Date.now();
            if (Number.isFinite(entry.expiresAt) && entry.expiresAt > now &&
                entry.expiresAt <= now + ttl && 'value' in entry) return entry.value;
          } catch { /* Corrupt cache entries are misses; the database remains authoritative. */ }
        }
      }

      const value = await loader();
      // Age from before the read, not after slow DB work or Redis recovery.
      const expiresAt = startedAt + ttl;
      const remaining = expiresAt - Date.now();
      if (version !== null && remaining > 0 && value !== null && value !== undefined) {
        try {
          const payload = JSON.stringify({ expiresAt, value });
          await this.command(() => this.redis!.set(valueKey, payload, 'PX', remaining));
        } catch { /* Non-JSON values can still be returned without caching. */ }
      }
      return value;
    });
  }

  /** Rotate a group version without SCAN/KEYS. False means only TTL-bounded invalidation is available. */
  async invalidatePrefix(prefix: string): Promise<boolean> {
    this.inFlight.clear();
    const result = await this.command(() => this.redis!.set(
      `${this.namespace}:${encodeURIComponent(prefix)}:version`, randomUUID(), 'PX', MAX_CACHE_TTL_MS * 2,
    ));
    if (!result.ok) this.bypassUntil = Date.now() + MAX_CACHE_TTL_MS;
    return result.ok;
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
    this.inFlight.clear();
  }

  private async command<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    if (!this.redis || this.redis.status !== 'ready' || Date.now() < this.bypassUntil) return { ok: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('CACHE_DEADLINE')), this.deadlineMs);
        }),
      ]);
      return { ok: true, value };
    } catch {
      // No error object is logged: connection errors can contain Redis credentials.
      this.bypassUntil = Date.now() + 1_000;
      return { ok: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
