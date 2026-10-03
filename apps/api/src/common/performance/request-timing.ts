import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Fixed, bounded labels only. Never use identities, URLs, SQL or external input as labels.
export const PERFORMANCE_STEPS = [
  'auth', 'session', 'telegram_validation', 'membership', 'worker', 'assignment',
  'geofence', 'attendance', 'idempotency', 'transaction', 'db', 'storage', 'storage_upload',
  'storage_sign', 'telegram', 'telegram_outbox', 'response_mapping', 'report_generation', 'image_processing',
  'handler', 'serialization', 'other',
] as const;
export type PerformanceStep = typeof PERFORMANCE_STEPS[number];
export interface StepTiming {
  durationMs: number;
  count: number;
  errors: number;
}
export interface RequestTiming {
  readonly requestId: string;
  readonly startedAt: number;
  readonly steps: Map<PerformanceStep, StepTiming>;
  serializationStartedAt?: number;
  serverMs?: number;
  failed: boolean;
  completed: boolean;
}

const storage = new AsyncLocalStorage<RequestTiming>();
const backgroundLogger = new Logger('BackgroundPerformance');
const allowedSteps = new Set<string>(PERFORMANCE_STEPS);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveRequestId(value: unknown): string {
  return typeof value === 'string' && uuid.test(value) ? value.toLowerCase() : randomUUID();
}

export function createRequestTiming(requestId?: unknown): RequestTiming {
  return {
    requestId: resolveRequestId(requestId), startedAt: performance.now(),
    steps: new Map(), failed: false, completed: false,
  };
}

export function runWithRequestTiming<T>(timing: RequestTiming, fn: () => T): T {
  return storage.run(timing, fn);
}

export function getRequestTiming(): RequestTiming | undefined {
  const timing = storage.getStore();
  return timing?.completed ? undefined : timing;
}

export function getRequestId(): string | undefined {
  return getRequestTiming()?.requestId;
}

export function recordStep(timing: RequestTiming, name: string, durationMs: number, failed = false): void {
  if (timing.completed) return;
  const label: PerformanceStep = allowedSteps.has(name) ? name as PerformanceStep : 'other';
  const step = timing.steps.get(label) ?? { durationMs: 0, count: 0, errors: 0 };
  step.durationMs += Math.max(0, durationMs);
  step.count += 1;
  step.errors += Number(failed);
  timing.steps.set(label, step);
}

export function startStep(name: string): (failed?: boolean) => void {
  const timing = getRequestTiming();
  if (!timing) return () => {};
  const startedAt = performance.now();
  let stopped = false;
  return (failed = false) => {
    if (stopped) return;
    stopped = true;
    recordStep(timing, name, performance.now() - startedAt, failed);
  };
}

/** Await a major step; preserves the result/error. Unknown labels collapse to "other". */
export async function timeStep<T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const stop = startStep(name);
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    stop(failed);
  }
}

/** A separate context/log for background jobs, including their DB spans; await to observe failure. */
export async function timeBackgroundStep<T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const parentRequestId = getRequestId();
  const timing = createRequestTiming();
  let failed = false;
  try {
    return await runWithRequestTiming(timing, () => timeStep(name, fn));
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    timing.completed = true;
    try {
      backgroundLogger.log({
        event: 'background_step_timing', requestId: timing.requestId, parentRequestId,
        failed, totalMs: roundMs(performance.now() - timing.startedAt), steps: snapshotSteps(timing),
      });
    } catch { /* Observability must not change job results. */ }
  }
}

export function roundMs(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

/** Inclusive sums: parallel and nested spans overlap, so never add them to total. */
export function snapshotSteps(timing: RequestTiming): Partial<Record<PerformanceStep, StepTiming>> {
  return Object.fromEntries([...timing.steps].map(([name, step]) => [name, {
    ...step, durationMs: roundMs(step.durationMs),
  }]));
}

export function serverTimingHeader(timing: RequestTiming): string {
  const entries = [`server;dur=${roundMs(timing.serverMs ?? performance.now() - timing.startedAt)}`];
  for (const [name, step] of timing.steps) entries.push(`${name};dur=${roundMs(step.durationMs)}`);
  return entries.join(', ');
}
