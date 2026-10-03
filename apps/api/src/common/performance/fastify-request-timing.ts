import { Logger } from '@nestjs/common';
import type { FastifyAdapter } from '@nestjs/platform-fastify';
import { performance } from 'node:perf_hooks';
import {
  createRequestTiming, recordStep, roundMs, runWithRequestTiming,
  serverTimingHeader, snapshotSteps, type RequestTiming,
} from './request-timing.js';

// getInstance is generic (ReturnType becomes unknown); get carries the concrete instance type.
type FastifyServer = ReturnType<FastifyAdapter['get']>;
const logger = new Logger('HttpPerformance');
export interface RequestTimingLog {
  event: 'http_request_timing';
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  outcome: 'response' | 'timeout' | 'aborted';
  failed: boolean;
  totalMs: number;
  serverMs?: number;
  steps: ReturnType<typeof snapshotSteps>;
}

/** Register before CORS/routes: onRequest runs before parsing, Nest guards and interceptors. */
export function registerRequestTiming(
  fastify: FastifyServer,
  log: (entry: RequestTimingLog) => void = (entry) => logger.log(entry),
): void {
  const contexts = new WeakMap<object, RequestTiming>();
  const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

  fastify.addHook('onRequest', (request, reply, done) => {
    const timing = createRequestTiming(request.headers['x-request-id']);
    contexts.set(request, timing);
    request.id = timing.requestId;
    reply.header('x-request-id', timing.requestId);
    // Continue the actual hook chain inside run, never enterWith (which can leak to siblings).
    runWithRequestTiming(timing, done);
  });

  fastify.addHook('preSerialization', (request, _reply, payload, done) => {
    const timing = contexts.get(request);
    if (timing) timing.serializationStartedAt = performance.now();
    done(null, payload);
  });

  fastify.addHook('onError', (request, _reply, _error, done) => {
    const timing = contexts.get(request);
    if (timing) {
      timing.failed = true;
      if (timing.serializationStartedAt !== undefined) {
        recordStep(timing, 'serialization', performance.now() - timing.serializationStartedAt, true);
        timing.serializationStartedAt = undefined;
      }
    }
    done();
  });

  fastify.addHook('onSend', (request, reply, payload, done) => {
    const timing = contexts.get(request);
    if (timing) {
      const now = performance.now();
      if (timing.serializationStartedAt !== undefined) {
        // Includes preSerialization hooks + Fastify serialization. Strings/streams skip it.
        recordStep(timing, 'serialization', now - timing.serializationStartedAt, timing.failed);
        timing.serializationStartedAt = undefined;
      }
      timing.serverMs = now - timing.startedAt;
      reply.header('x-request-id', timing.requestId);
      // Headers cannot contain onResponse time, which is recorded separately as totalMs.
      reply.header('Server-Timing', serverTimingHeader(timing));
    }
    done(null, payload);
  });

  const finish = (
    request: { method: string; routeOptions?: { url?: string } },
    statusCode: number,
    outcome: RequestTimingLog['outcome'],
  ) => {
    const timing = contexts.get(request);
    if (!timing || timing.completed) return;
    timing.completed = true;
    const entry: RequestTimingLog = {
      event: 'http_request_timing', requestId: timing.requestId,
      method: methods.has(request.method) ? request.method : 'OTHER',
      // No raw URL fallback: unmatched routes can contain names, tokens or coordinates.
      route: request.routeOptions?.url ?? 'unmatched',
      statusCode, outcome, failed: timing.failed || statusCode >= 400 || outcome !== 'response',
      totalMs: roundMs(performance.now() - timing.startedAt),
      serverMs: timing.serverMs === undefined ? undefined : roundMs(timing.serverMs),
      steps: snapshotSteps(timing),
    };
    try { log(entry); } catch { /* Observability must not change request behavior. */ }
  };

  fastify.addHook('onResponse', (request, reply, done) => {
    finish(request, reply.statusCode, 'response');
    done();
  });
  fastify.addHook('onTimeout', (request, reply, done) => {
    finish(request, reply.statusCode, 'timeout');
    done();
  });
  fastify.addHook('onRequestAbort', (request, done) => {
    finish(request, 0, 'aborted');
    done();
  });
}
