import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createRequestTiming, runWithRequestTiming, snapshotSteps } from '../src/common/performance/request-timing.js';

// Only the engine boundary is stubbed: real generated Prisma client, extensions, lazy
// PrismaPromises, batching and interactive transaction propagation execute in these tests.
type Engine = {
  request: (query: { action: string }, options: unknown) => Promise<unknown>;
  requestBatch: (queries: { action: string }[], options: unknown) => Promise<unknown[]>;
  transaction: (action: string, headers: unknown, options: unknown) => Promise<unknown>;
};

describe('Prisma request timing transaction integration', () => {
  let prisma: PrismaService;
  let engine: Engine;
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@127.0.0.1:1/test');
    prisma = new PrismaService();
    engine = (prisma as unknown as { _engine: Engine })._engine;
    vi.spyOn(engine, 'request').mockImplementation(async query => ({ data: { [query.action]: [] } }));
    vi.spyOn(engine, 'requestBatch').mockImplementation(async queries => queries.map(query => ({ data: { [query.action]: [] } })));
    vi.spyOn(engine, 'transaction').mockImplementation(async action => action === 'start' ? { id: 'test-transaction', payload: {} } : undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('retains lifecycle/scoped helpers and records model/raw operations without values', async () => {
    expect(typeof prisma.onModuleInit).toBe('function');
    expect(typeof prisma.onModuleDestroy).toBe('function');
    expect(typeof prisma.forOrganization).toBe('function');
    const timing = createRequestTiming();
    await runWithRequestTiming(timing, async () => {
      await prisma.employee.findMany({ where: { organizationId: 'secret-organization', fullName: 'secret-name' } });
      await prisma.$executeRaw`SELECT ${'secret-value'}`;
      await prisma.forOrganization('secret-organization').employees.findById('secret-employee');
    });
    expect(timing.steps.get('db')).toMatchObject({ count: 3, errors: 0 });
    expect(JSON.stringify(snapshotSteps(timing))).not.toMatch(/secret|SELECT|employee|organization/);
  });

  it('preserves lazy promises and array transaction batching', async () => {
    const timing = createRequestTiming();
    await runWithRequestTiming(timing, async () => {
      const queries = [prisma.employee.findMany(), prisma.project.findMany()];
      expect(queries[0][Symbol.toStringTag]).toBe('PrismaPromise');
      expect(timing.steps.size).toBe(0);
      expect(engine.request).not.toHaveBeenCalled();
      await expect(prisma.$transaction(queries)).resolves.toEqual([[], []]);
    });
    expect(engine.request).not.toHaveBeenCalled();
    expect(engine.requestBatch).toHaveBeenCalledTimes(1);
    expect(engine.requestBatch).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ transaction: expect.objectContaining({ kind: 'batch' }) }));
    expect(timing.steps.get('db')).toMatchObject({ count: 2, errors: 0 });
  });

  it('keeps interactive queries on the transaction client and propagates options', async () => {
    const timing = createRequestTiming();
    await runWithRequestTiming(timing, () => prisma.$transaction(async tx => {
      await tx.employee.findMany();
      await tx.project.findMany();
    }, { timeout: 1234, maxWait: 567 }));
    expect(engine.transaction).toHaveBeenCalledWith('start', expect.anything(), expect.objectContaining({ timeout: 1234, maxWait: 567 }));
    expect(engine.transaction).toHaveBeenCalledWith('commit', expect.anything(), expect.objectContaining({ id: 'test-transaction' }));
    for (const call of vi.mocked(engine.request).mock.calls) {
      expect(call[1]).toMatchObject({ interactiveTransaction: { id: 'test-transaction' } });
    }
    expect(timing.steps.get('db')).toMatchObject({ count: 2, errors: 0 });
  });

  it('counts failed queries, rolls back, and never puts error messages into timing', async () => {
    vi.mocked(engine.request).mockRejectedValue(new Error('private SQL parameters password'));
    const timing = createRequestTiming();
    await expect(runWithRequestTiming(timing, () => prisma.$transaction(tx => tx.employee.findMany()))).rejects.toThrow('private SQL');
    expect(engine.transaction).toHaveBeenCalledWith('rollback', expect.anything(), expect.objectContaining({ id: 'test-transaction' }));
    expect(timing.steps.get('db')).toMatchObject({ count: 1, errors: 1 });
    expect(JSON.stringify(snapshotSteps(timing))).not.toMatch(/private|parameters|password/);
  });

  it('attributes concurrent database queries to their own request contexts', async () => {
    vi.mocked(engine.request).mockImplementation(async query => {
      await delay(3);
      return { data: { [query.action]: [] } };
    });
    const first = createRequestTiming();
    const second = createRequestTiming();
    await Promise.all([
      runWithRequestTiming(first, async () => {
        await prisma.employee.findMany();
        await prisma.project.findMany();
      }),
      runWithRequestTiming(second, async () => await prisma.employee.findMany()),
    ]);
    expect(first.steps.get('db')).toMatchObject({ count: 2, errors: 0 });
    expect(second.steps.get('db')).toMatchObject({ count: 1, errors: 0 });
    expect(first.steps.get('db')?.durationMs).toBeGreaterThan(0);
    expect(second.steps.get('db')?.durationMs).toBeGreaterThan(0);
  });
});
