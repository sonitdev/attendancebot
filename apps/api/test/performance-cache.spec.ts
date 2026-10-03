import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../src/auth/guards/auth.guard.js';
import type { WorkerPrincipal } from '../src/auth/principal.js';
import { SessionService } from '../src/auth/session.service.js';
import { isVerifiedWorker } from '../src/auth/verified-worker.js';
import { createCacheRedis } from '../src/common/cache/cache.module.js';
import { CacheService, cacheNamespace, type CacheRedis } from '../src/common/cache/cache.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { TelegramInitDataVerifier } from '../src/telegram/telegram-init-data.verifier.js';
import { TelegramSessionService } from '../src/telegram/telegram-session.service.js';

const BOT_TOKEN = '12345:bot-secret';
const SECRET = 'test-session-secret-at-least-thirty-two-characters';
function config(extra: Record<string, string> = {}) {
  return new ConfigService({
    DATABASE_URL: 'postgresql://app:db-secret@db.test:5432/attendance?schema=public',
    CACHE_NAMESPACE: 'test-server', NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    SESSION_SECRET: SECRET, ...extra,
  });
}

class MemoryRedis {
  status = 'ready';
  values = new Map<string, { value: string; expiresAt: number }>();
  get = vi.fn(async (key: string): Promise<string | null> => {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  });
  set = vi.fn(async (key: string, value: string, _mode: string, ttl: number) => {
    this.values.set(key, { value, expiresAt: Date.now() + ttl });
    return 'OK';
  });
  disconnect = vi.fn();
  cache(cfg = config()) { return new CacheService(cfg, this as unknown as CacheRedis); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('bounded Redis cache', () => {
  const key = { prefix: 'org-1:worker-projects:employee-1', key: 'list' };

  it('hits until expiry, coalesces concurrent cold loads, and never extends TTL on reads', async () => {
    vi.useFakeTimers();
    const redis = new MemoryRedis();
    const cache = redis.cache();
    const load = vi.fn().mockResolvedValue(['project-1']);
    expect(await Promise.all(Array.from({ length: 20 }, () => cache.getOrLoad(key, 15_000, load))))
      .toEqual(Array.from({ length: 20 }, () => ['project-1']));
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(await cache.getOrLoad(key, 15_000, load)).toEqual(['project-1']);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await cache.getOrLoad(key, 15_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caps TTL at 30 seconds, including slow loads', async () => {
    vi.useFakeTimers();
    const redis = new MemoryRedis();
    const cache = redis.cache();
    const load = vi.fn(async () => { await vi.advanceTimersByTimeAsync(5_000); return 'fresh'; });
    await cache.getOrLoad(key, 120_000, load);
    expect(redis.set.mock.calls[0][3]).toBe(25_000);
  });

  it('isolates tenants, database/schema, environment, and configured server namespaces', async () => {
    const redis = new MemoryRedis();
    await redis.cache().getOrLoad(key, 15_000, async () => 'org-1');
    expect(await redis.cache().getOrLoad({ ...key, prefix: 'org-2:worker-projects:employee-1' }, 15_000, async () => 'org-2'))
      .toBe('org-2');
    for (const override of [
      { CACHE_NAMESPACE: 'other-server' }, { NODE_ENV: 'production' },
      { DATABASE_URL: 'postgresql://other:secret@other.test/db?schema=other' },
    ]) {
      expect(await redis.cache(config(override)).getOrLoad(key, 15_000, async () => 'other')).toBe('other');
    }
    expect(cacheNamespace(config())).not.toContain('db-secret');
    expect(cacheNamespace(config())).not.toContain('postgresql');
  });

  it('invalidates across instances and prevents late loaders from filling the new version', async () => {
    const redis = new MemoryRedis();
    const a = redis.cache();
    const b = redis.cache();
    const pending = deferred<string>();
    const started = deferred<void>();
    const old = a.getOrLoad(key, 15_000, () => { started.resolve(); return pending.promise; });
    await started.promise;
    expect(await b.invalidatePrefix(key.prefix)).toBe(true);
    expect(await b.getOrLoad(key, 15_000, async () => 'new')).toBe('new');
    pending.resolve('old');
    expect(await old).toBe('old');
    expect(await a.getOrLoad(key, 15_000, async () => 'wrong')).toBe('new');
  });

  it('cannot revive old values when version markers expire', async () => {
    vi.useFakeTimers();
    const redis = new MemoryRedis();
    const cache = redis.cache();
    await cache.getOrLoad(key, 30_000, async () => 'old');
    await cache.invalidatePrefix(key.prefix);
    await cache.getOrLoad(key, 30_000, async () => 'new');
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await cache.getOrLoad(key, 30_000, async () => 'latest')).toBe('latest');
  });

  it('bypasses disconnected Redis and does not retain database values locally', async () => {
    const redis = new MemoryRedis();
    redis.status = 'reconnecting';
    const cache = redis.cache();
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    expect(await cache.getOrLoad(key, 15_000, load)).toBe('first');
    expect(await cache.getOrLoad(key, 15_000, load)).toBe('second');
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('bounds a stalled Redis command at 40ms then recovers after the circuit interval', async () => {
    vi.useFakeTimers();
    const redis = new MemoryRedis();
    redis.get.mockImplementationOnce(() => new Promise(() => undefined));
    const cache = redis.cache();
    const load = vi.fn().mockResolvedValue('db');
    const result = cache.getOrLoad(key, 15_000, load);
    await vi.advanceTimersByTimeAsync(39);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('db');
    await vi.advanceTimersByTimeAsync(1_000);
    await cache.getOrLoad(key, 15_000, load);
    await cache.getOrLoad(key, 15_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never serves stale values on loader failure or retains a rejected loader', async () => {
    vi.useFakeTimers();
    const cache = new MemoryRedis().cache();
    await cache.getOrLoad(key, 15_000, async () => 'old');
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(cache.getOrLoad(key, 15_000, async () => { throw new Error('DB unavailable'); }))
      .rejects.toThrow('DB unavailable');
    expect(await cache.getOrLoad(key, 15_000, async () => 'new')).toBe('new');
  });

  it('treats corrupted entries as misses and does not cache null', async () => {
    const redis = new MemoryRedis();
    const cache = redis.cache();
    await cache.getOrLoad(key, 15_000, async () => 'old');
    const value = [...redis.values.values()][0];
    value.value = '{broken';
    expect(await cache.getOrLoad(key, 15_000, async () => 'new')).toBe('new');
    const empty = vi.fn().mockResolvedValue(null);
    await cache.getOrLoad({ ...key, key: 'empty' }, 15_000, empty);
    await cache.getOrLoad({ ...key, key: 'empty' }, 15_000, empty);
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it('reports failed invalidation and bypasses local cache for the maximum TTL', async () => {
    vi.useFakeTimers();
    const redis = new MemoryRedis();
    const cache = redis.cache();
    await cache.getOrLoad(key, 30_000, async () => 'old');
    redis.set.mockRejectedValueOnce(new Error('down'));
    expect(await cache.invalidatePrefix(key.prefix)).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await cache.getOrLoad(key, 30_000, async () => 'fresh')).toBe('fresh');
  });

  it('bounds in-flight entries and releases hanging work from deduplication after one second', async () => {
    vi.useFakeTimers();
    const cache = new MemoryRedis().cache();
    const never = () => new Promise<string>(() => undefined);
    for (let i = 0; i < 512; i++) void cache.coalesce(`pending-${i}`, never);
    const extra = vi.fn().mockResolvedValue('bypass');
    expect(await cache.coalesce('overflow', extra)).toBe('bypass');
    expect(await cache.coalesce('overflow', extra)).toBe('bypass');
    expect(extra).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await cache.coalesce('pending-0', async () => 'fresh')).toBe('fresh');
  });

  it('reconnects in the background with no offline queue or command replay', () => {
    vi.spyOn(Redis.prototype, 'connect').mockResolvedValue(undefined);
    const client = createCacheRedis(config({ REDIS_URL: 'redis://localhost:6379' }))!;
    expect(client.options.enableOfflineQueue).toBe(false);
    expect(client.options.maxRetriesPerRequest).toBe(0);
    expect(client.options.autoResendUnfulfilledCommands).toBe(false);
    expect(client.options.commandTimeout).toBe(40);
    expect(client.options.retryStrategy!(1)).toBe(1_000);
    expect(client.options.retryStrategy!(100)).toBe(30_000);
    client.disconnect();
  });
});

function initData(userId = 123456, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id: userId, first_name: 'Alice' }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ta-1', organizationId: 'org-1', employeeId: 'emp-1', telegramUserId: '123456', status: 'ACTIVE',
    emp_id: 'emp-1', emp_organizationId: 'org-1', emp_employeeCode: 'E001', emp_fullName: 'Alice',
    emp_avatarUrl: null, emp_status: 'ACTIVE', pos_id: null, pos_code: null, pos_name: null,
    org_id: 'org-1', org_name: 'Acme', org_slug: 'acme', ...overrides,
  };
}

function sessionFixture() {
  const redis = new MemoryRedis();
  const cache = redis.cache();
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([row()]),
    telegramAccount: { update: vi.fn().mockResolvedValue({}), findMany: vi.fn() },
    employee: { updateMany: vi.fn().mockResolvedValue({}) },
    registrationRequest: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const verifier = new TelegramInitDataVerifier();
  const verify = vi.spyOn(verifier, 'verify');
  const sessions = new SessionService(config());
  const service = new TelegramSessionService(config(), verifier, prisma as unknown as PrismaService, sessions, cache);
  return { service, sessions, prisma, redis, verify };
}

describe('Telegram session cache security and read performance', () => {
  it('verifies HMAC on every warm session with no database reads/writes and stays under 500ms locally', async () => {
    const f = sessionFixture();
    const data = initData();
    const first = await f.service.createSession(data);
    f.prisma.$queryRaw.mockClear();
    f.prisma.telegramAccount.update.mockClear();
    const started = performance.now();
    const second = await f.service.createSession(data);
    expect(performance.now() - started).toBeLessThan(500);
    expect(f.verify).toHaveBeenCalledTimes(2);
    expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(f.prisma.telegramAccount.update).not.toHaveBeenCalled();
    expect(second.token).not.toBe(first.token);
    expect(f.sessions.verifyWorkerToken(second.token).organizationId).toBe('org-1');
    const payload = JSON.stringify([...f.redis.values.entries()]);
    for (const forbidden of [BOT_TOKEN, SECRET, first.token, second.token, data, 'latitude', 'longitude', 'initData']) {
      expect(payload).not.toContain(forbidden);
    }
    expect([...f.redis.values.keys()].some((key) => decodeURIComponent(key).includes('org-1'))).toBe(true);
  });

  it('rejects forged or stale initData even after the identity cache is warm', async () => {
    const f = sessionFixture();
    const data = initData();
    await f.service.createSession(data);
    f.redis.get.mockClear();
    await expect(f.service.createSession(data.replace('hash=', 'hash=00'))).rejects.toThrow('TELEGRAM_INVALID');
    await expect(f.service.createSession(initData(123456, Math.floor(Date.now() / 1000) - 86_500)))
      .rejects.toThrow('TELEGRAM_INVALID');
    expect(f.redis.get).not.toHaveBeenCalled();
    expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('refreshes account state at 15 seconds and rejects new cross-organization ambiguity', async () => {
    vi.useFakeTimers();
    const f = sessionFixture();
    await f.service.createSession(initData());
    f.prisma.$queryRaw.mockResolvedValue([row(), row({ organizationId: 'org-2', id: 'ta-2' })]);
    await vi.advanceTimersByTimeAsync(14_999);
    await f.service.createSession(initData());
    expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(f.service.createSession(initData())).rejects.toThrow('TELEGRAM_ACCOUNT_AMBIGUOUS');
    expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects multiple accounts without choosing one with a current project', async () => {
    const f = sessionFixture();
    f.prisma.$queryRaw.mockResolvedValue([row(), row({ id: 'ta-2', organizationId: 'org-2', emp_currentProjectId: 'p-1' })]);
    await expect(f.service.createSession(initData())).rejects.toThrow('TELEGRAM_ACCOUNT_AMBIGUOUS');
    expect(f.redis.set).not.toHaveBeenCalled();
    expect(f.prisma.telegramAccount.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ emp_status: 'INACTIVE' }, 'EMPLOYEE_INACTIVE'],
    [{ status: 'INACTIVE' }, 'TELEGRAM_ACCOUNT_INACTIVE'],
    [{ emp_organizationId: 'org-2' }, 'FORBIDDEN_SCOPE'],
    [{ org_id: 'org-2' }, 'FORBIDDEN_SCOPE'],
    [{ telegramUserId: 'other' }, 'FORBIDDEN_SCOPE'],
  ])('does not cache invalid account state %j', async (overrides, code) => {
    const f = sessionFixture();
    f.prisma.$queryRaw.mockResolvedValue([row(overrides)]);
    await expect(f.service.createSession(initData())).rejects.toThrow(code);
    expect(f.redis.set).not.toHaveBeenCalled();
  });

  it('scopes each user and bot separately and parameterizes the one joined DB query', async () => {
    const f = sessionFixture();
    await f.service.createSession(initData());
    f.prisma.$queryRaw.mockResolvedValue([row({ telegramUserId: '789012' })]);
    await f.service.createSession(initData(789012));
    expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(2);
    const [sql, parameter] = f.prisma.$queryRaw.mock.calls[0];
    expect(parameter).toBe('123456');
    const query = sql.join('?');
    expect(query).toContain('e."organizationId" = ta."organizationId"');
    expect(query).toContain('p."organizationId" = ta."organizationId"');
    expect(query).toContain('LIMIT 2');
    expect(query).not.toContain('123456');
  });

  it('falls back to the database during Redis outage without stale local authorization', async () => {
    const f = sessionFixture();
    await f.service.createSession(initData());
    f.redis.status = 'reconnecting';
    f.prisma.$queryRaw.mockResolvedValue([row({ emp_status: 'INACTIVE' })]);
    await expect(f.service.createSession(initData())).rejects.toThrow('EMPLOYEE_INACTIVE');
  });

  it('does not turn an empty joined result or DB error into another unscoped lookup', async () => {
    const f = sessionFixture();
    f.prisma.$queryRaw.mockResolvedValue([]);
    await expect(f.service.createSession(initData())).rejects.toThrow('TELEGRAM_UNLINKED');
    expect(f.prisma.telegramAccount.findMany).not.toHaveBeenCalled();
    f.prisma.$queryRaw.mockRejectedValue(new Error('database down'));
    await expect(f.service.createSession(initData())).rejects.toThrow('database down');
    expect(f.prisma.telegramAccount.findMany).not.toHaveBeenCalled();
  });
});

function worker(overrides: Partial<WorkerPrincipal> = {}): WorkerPrincipal {
  return { type: 'worker', organizationId: 'org-1', employeeId: 'emp-1', telegramUserId: '123456', sessionId: 's-1', ...overrides };
}
function context(method = 'GET') {
  const request = { method, headers: { authorization: 'Bearer valid' }, principal: undefined as WorkerPrincipal | undefined };
  const execution = {
    switchToHttp: () => ({ getRequest: () => request }), getHandler: () => ({}), getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { request, execution };
}
function guardFixture() {
  const redis = new MemoryRedis();
  const sessions = { verifyToken: vi.fn(() => worker()) };
  const prisma = {
    telegramAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'ta-1' }) },
    user: { findFirst: vi.fn().mockResolvedValue({ roles: [{ role: { code: 'OWNER' } }] }) },
  };
  const guard = new AuthGuard(new Reflector(), sessions as unknown as SessionService, prisma as unknown as PrismaService, redis.cache());
  return { guard, sessions, prisma, redis };
}

describe('fresh request authorization and unforgeable request-local verification', () => {
  it('marks only a DB-verified principal and cannot accept token fields or copied principals', async () => {
    const f = guardFixture();
    const principal = { ...worker(), verified: true, alreadyVerified: true };
    f.sessions.verifyToken.mockReturnValue(principal);
    expect(isVerifiedWorker(principal)).toBe(false);
    const req = context();
    await f.guard.canActivate(req.execution);
    expect(isVerifiedWorker(req.request.principal!)).toBe(true);
    expect(isVerifiedWorker({ ...req.request.principal! })).toBe(false);
    expect(f.prisma.telegramAccount.findFirst).toHaveBeenCalledWith({
      where: {
        telegramUserId: '123456', employeeId: 'emp-1', organizationId: 'org-1', status: 'ACTIVE',
        employee: { status: 'ACTIVE', organizationId: 'org-1' },
      }, select: { id: true },
    });
    expect(f.redis.get).not.toHaveBeenCalled();
  });

  it('coalesces overlapping GETs but rechecks every subsequent GET', async () => {
    const f = guardFixture();
    const pending = deferred<{ id: string }>();
    f.prisma.telegramAccount.findFirst.mockReturnValueOnce(pending.promise);
    const first = f.guard.canActivate(context().execution);
    const second = f.guard.canActivate(context().execution);
    await Promise.resolve();
    expect(f.prisma.telegramAccount.findFirst).toHaveBeenCalledTimes(1);
    pending.resolve({ id: 'ta-1' });
    await Promise.all([first, second]);
    f.prisma.telegramAccount.findFirst.mockResolvedValue(null);
    await expect(f.guard.canActivate(context().execution)).rejects.toThrow('WORKER_SESSION_REVOKED');
    expect(f.prisma.telegramAccount.findFirst).toHaveBeenCalledTimes(2);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('always checks %s in DB while a GET is pending', async (method) => {
    const f = guardFixture();
    const pending = deferred<{ id: string }>();
    f.prisma.telegramAccount.findFirst.mockReturnValueOnce(pending.promise).mockResolvedValue(null);
    const read = f.guard.canActivate(context().execution);
    await Promise.resolve();
    await expect(f.guard.canActivate(context(method).execution)).rejects.toThrow('WORKER_SESSION_REVOKED');
    expect(f.prisma.telegramAccount.findFirst).toHaveBeenCalledTimes(2);
    pending.resolve({ id: 'ta-1' });
    await read;
  });

  it('keeps parallel tenant identities separate and fails closed on database error', async () => {
    const f = guardFixture();
    f.sessions.verifyToken.mockReturnValueOnce(worker()).mockReturnValueOnce(worker({ organizationId: 'org-2' }));
    await Promise.all([f.guard.canActivate(context().execution), f.guard.canActivate(context().execution)]);
    expect(f.prisma.telegramAccount.findFirst).toHaveBeenCalledTimes(2);
    const principal = worker();
    f.sessions.verifyToken.mockReturnValue(principal);
    f.prisma.telegramAccount.findFirst.mockRejectedValue(new Error('DB down'));
    await expect(f.guard.canActivate(context('POST').execution)).rejects.toThrow('DB down');
    expect(isVerifiedWorker(principal)).toBe(false);
  });

  it('refreshes admin roles and revocation on each new read or mutation', async () => {
    const f = guardFixture();
    const admin = { type: 'admin', organizationId: 'org-1', userId: 'user-1', email: 'a@example.test', roles: [], permissions: [] };
    f.sessions.verifyToken.mockImplementation(() => ({ ...admin }) as unknown as WorkerPrincipal);
    const first = context();
    await f.guard.canActivate(first.execution);
    expect(first.request.principal).toMatchObject({ roles: ['OWNER'] });
    f.prisma.user.findFirst.mockResolvedValue({ roles: [{ role: { code: 'HR' } }] });
    const next = context('POST');
    await f.guard.canActivate(next.execution);
    expect(next.request.principal).toMatchObject({ roles: ['HR'] });
    f.prisma.user.findFirst.mockResolvedValue(null);
    await expect(f.guard.canActivate(context().execution)).rejects.toThrow('ADMIN_SESSION_REVOKED');
    expect(f.prisma.user.findFirst).toHaveBeenCalledTimes(3);
    expect(f.redis.get).not.toHaveBeenCalled();
  });
});
