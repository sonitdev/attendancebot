import 'reflect-metadata';
import { BadRequestException, Controller, Get, Logger, Module, Post, UnauthorizedException, UseGuards, type ExecutionContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpLatencyLoggingInterceptor } from '../src/common/interceptors/http-latency.interceptor.js';
import { registerRequestTiming, type RequestTimingLog } from '../src/common/performance/fastify-request-timing.js';
import {
  createRequestTiming, getRequestId, getRequestTiming, resolveRequestId,
  runWithRequestTiming, serverTimingHeader, snapshotSteps, timeBackgroundStep, timeStep,
} from '../src/common/performance/request-timing.js';

const firstId = 'e5be0261-09af-438f-97c8-8d0fb1102afa';
const secondId = 'e5be0261-09af-438f-97c8-8d0fb1102afb';
const secret = 'private-token-user-location-SQL';

describe('request-local timing', () => {
  it('isolates overlapping requests, captures rejected/synchronous spans and preserves errors', async () => {
    const first = createRequestTiming(firstId);
    const second = createRequestTiming(secondId);
    const error = new Error(secret);
    await Promise.all([
      runWithRequestTiming(first, () => timeStep('auth', async () => {
        await delay(8);
        expect(getRequestId()).toBe(firstId);
        await expect(timeStep('session', () => { throw error; })).rejects.toBe(error);
      })),
      runWithRequestTiming(second, () => timeStep('worker', async () => {
        await delay(2);
        expect(getRequestId()).toBe(secondId);
        expect(getRequestTiming()).toBe(second);
      })),
    ]);
    expect(first.steps.get('auth')?.durationMs).toBeGreaterThan(0);
    expect(first.steps.get('session')).toMatchObject({ count: 1, errors: 1 });
    expect(first.steps.has('worker')).toBe(false);
    expect(second.steps.has('auth')).toBe(false);
    expect(getRequestTiming()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
    await expect(timeStep('worker', () => 42)).resolves.toBe(42);
    await expect(timeStep('worker', () => Promise.reject(error))).rejects.toBe(error);
  });

  it('bounds labels, rejects unsafe correlation IDs and ignores work after response completion', async () => {
    expect(resolveRequestId(firstId.toUpperCase())).toBe(firstId);
    for (const input of [secret, [firstId, secondId], '0'.repeat(36), `${firstId},${secondId}`, undefined]) {
      expect(resolveRequestId(input)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    const timing = createRequestTiming(firstId);
    await runWithRequestTiming(timing, async () => {
      for (let i = 0; i < 50; i++) await timeStep(`${secret}-${i}`, () => 1);
      expect(timing.steps.size).toBe(1);
      expect(timing.steps.get('other')?.count).toBe(50);
      expect(JSON.stringify(snapshotSteps(timing))).not.toContain(secret);
      expect(serverTimingHeader(timing)).not.toContain(secret);
      await timeStep('telegram', async () => { timing.completed = true; });
      expect(getRequestId()).toBeUndefined();
      expect(timing.steps.has('telegram')).toBe(false);
    });
  });

  it('isolates background spans and logs only safe aggregates on success and rejection', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    try {
      const parent = createRequestTiming(firstId);
      await runWithRequestTiming(parent, async () => {
        await expect(timeBackgroundStep('report_generation', async () => {
          expect(getRequestId()).not.toBe(firstId);
          await timeStep('db', () => delay(2));
          return 'done';
        })).resolves.toBe('done');
        expect(getRequestId()).toBe(firstId);
        expect(parent.steps.size).toBe(0);
      });
      const error = new Error(secret);
      await expect(timeBackgroundStep('image_processing', () => { throw error; })).rejects.toBe(error);
      expect(log).toHaveBeenCalledTimes(2);
      expect(log.mock.calls[0][0]).toMatchObject({ event: 'background_step_timing', parentRequestId: firstId, failed: false, steps: { db: { count: 1 }, report_generation: { count: 1 } } });
      expect(log.mock.calls[1][0]).toMatchObject({ failed: true, steps: { image_processing: { count: 1, errors: 1 } } });
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    } finally { log.mockRestore(); }
  });
});

class TimingGuard {
  async canActivate(context: ExecutionContext) {
    return timeStep('auth', async () => {
      expect(getRequestId()).toMatch(/^[0-9a-f-]{36}$/);
      await delay(10);
      if (context.switchToHttp().getRequest().headers['x-deny']) throw new UnauthorizedException(secret);
      return true;
    });
  }
}

@Controller('timing')
@UseGuards(TimingGuard)
class TimingController {
  @Get('records/:id')
  async success() {
    await timeStep('worker', () => delay(3));
    return {
      toJSON() {
        const started = performance.now();
        while (performance.now() - started < 6) { /* Make serialization measurable. */ }
        return { requestId: getRequestId(), ok: true };
      },
    };
  }

  @Get('error')
  async error() {
    return timeStep('attendance', async () => {
      await delay(2);
      throw new BadRequestException(secret);
    });
  }

  @Post('body')
  body() { return { ok: true }; }

  @Get('text')
  text() { return 'ok'; }

  @Get('serialization-error')
  serializationError() { return { toJSON() { throw new Error(secret); } }; }
}

@Module({ controllers: [TimingController], providers: [TimingGuard] })
class TimingModule {}

describe('Fastify lifecycle + actual Nest guards/interceptor', () => {
  let app: NestFastifyApplication;
  const records: RequestTimingLog[] = [];
  beforeAll(async () => {
    const adapter = new FastifyAdapter({ bodyLimit: 128 });
    registerRequestTiming(adapter.getInstance(), entry => records.push(entry));
    app = await NestFactory.create<NestFastifyApplication>(TimingModule, adapter, { logger: false });
    app.useGlobalInterceptors(new HttpLatencyLoggingInterceptor());
    app.enableCors({ origin: true, allowedHeaders: ['x-request-id'], exposedHeaders: ['x-request-id', 'Server-Timing'] });
    await app.init();
  });
  beforeEach(() => { records.length = 0; });
  afterAll(async () => { await app.close(); });

  it('correlates concurrent requests, includes guards and separates handler/serialization/total', async () => {
    const responses = await Promise.all([firstId, secondId].map(requestId => app.inject({
      method: 'GET', url: `/timing/records/${secret}?token=${secret}`,
      headers: { 'x-request-id': requestId, authorization: secret, origin: 'https://example.test' },
    })));
    expect(records).toHaveLength(2);
    for (const [i, response] of responses.entries()) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBe([firstId, secondId][i]);
      expect(response.json().requestId).toBe([firstId, secondId][i]);
      expect(response.headers['server-timing']).toContain('server;dur=');
      expect(response.headers['server-timing']).toContain('handler;dur=');
      expect(response.headers['server-timing']).toContain('serialization;dur=');
      expect(response.headers['access-control-expose-headers']).toContain('Server-Timing');
    }
    for (const record of records) {
      expect(record.route).toBe('/timing/records/:id');
      expect(record.steps.auth?.durationMs).toBeGreaterThanOrEqual(8);
      expect(record.steps.serialization?.durationMs).toBeGreaterThanOrEqual(5);
      expect(record.totalMs).toBeGreaterThan(record.steps.handler!.durationMs);
      expect(record.totalMs).toBeGreaterThanOrEqual(record.serverMs!);
      expect(record.failed).toBe(false);
    }
    expect(JSON.stringify(records)).not.toContain(secret);
    expect(getRequestId()).toBeUndefined();
  });

  it('times denied guards even when the Nest interceptor never runs', async () => {
    const response = await app.inject({ method: 'GET', url: '/timing/error', headers: { 'x-deny': 'yes', 'x-request-id': firstId } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['x-request-id']).toBe(firstId);
    expect(response.headers['server-timing']).toContain('auth;dur=');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ failed: true, statusCode: 401 });
    expect(records[0].steps.auth).toMatchObject({ count: 1, errors: 1 });
    expect(records[0].steps.handler).toBeUndefined();
    expect(JSON.stringify(records)).not.toContain(secret);
  });

  it('times controller rejection and error serialization without recording error text', async () => {
    const response = await app.inject({ method: 'GET', url: '/timing/error' });
    expect(response.statusCode).toBe(400);
    expect(response.headers['server-timing']).toContain('attendance;dur=');
    expect(records[0].steps.attendance).toMatchObject({ count: 1, errors: 1 });
    expect(records[0].steps.handler).toMatchObject({ count: 1, errors: 1 });
    expect(JSON.stringify(records)).not.toContain(secret);
  });

  it('handles parser errors, oversized bodies, unsafe request IDs, and private unmatched paths', async () => {
    for (const payload of ['{"bad"', JSON.stringify({ secret: secret.repeat(10) })]) {
      const response = await app.inject({ method: 'POST', url: '/timing/body', payload, headers: { 'content-type': 'application/json', 'x-request-id': secret } });
      expect([400, 413]).toContain(response.statusCode);
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers['server-timing']).toContain('server;dur=');
    }
    const missing = await app.inject({ method: 'GET', url: `/private/${secret}?location=${secret}` });
    expect(missing.statusCode).toBe(404);
    expect(records).toHaveLength(3);
    expect(records.every(record => record.failed && record.totalMs >= 0)).toBe(true);
    expect(JSON.stringify(records)).not.toContain(secret);
  });

  it('records failed serialization and the replacement error response', async () => {
    const response = await app.inject({ method: 'GET', url: '/timing/serialization-error' });
    expect(response.statusCode).toBe(500);
    expect(response.headers['server-timing']).toContain('serialization;dur=');
    expect(records).toHaveLength(1);
    expect(records[0].steps.serialization?.errors).toBeGreaterThanOrEqual(1);
    expect(records[0].failed).toBe(true);
    expect(JSON.stringify(records)).not.toContain(secret);
  });

  it('does not invent serialization timings for text; covers CORS short circuits', async () => {
    const response = await app.inject({ method: 'GET', url: '/timing/text' });
    expect(response.body).toBe('ok');
    expect(records[0].steps.serialization).toBeUndefined();
    const preflight = await app.inject({ method: 'OPTIONS', url: '/timing/text', headers: {
      origin: 'https://example.test', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-request-id',
    } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-headers']).toContain('x-request-id');
    expect(preflight.headers['server-timing']).toContain('server;dur=');
    expect(records).toHaveLength(2);
  });
});
