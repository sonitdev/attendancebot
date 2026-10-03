import { describe, expect, it, vi } from 'vitest';
import { poolWarmupQueries, warmReadPool } from '../src/prisma/pool-warmup.js';

describe('bounded read-only startup pool warmup', () => {
  const database = 'postgresql://test:test@localhost/test';
  it('defaults to four probes and respects smaller configured pool limits', () => {
    expect(poolWarmupQueries(database)).toBe(4);
    expect(poolWarmupQueries(`${database}?connection_limit=1`)).toBe(1);
    expect(poolWarmupQueries(`${database}?connection_limit=2`)).toBe(2);
    expect(poolWarmupQueries(`${database}?connection_limit=20`)).toBe(4);
  });
  it('allows opting out or down without unbounded environment-driven fanout', () => {
    expect(poolWarmupQueries(database, '0')).toBe(0);
    expect(poolWarmupQueries(database, '2')).toBe(2);
    expect(poolWarmupQueries(database, '100000')).toBe(4);
    for (const value of ['NaN', '-1', '1.5', 'Infinity']) {
      expect(poolWarmupQueries(database, value)).toBe(4);
    }
    expect(poolWarmupQueries('invalid')).toBe(0);
  });
  it('starts all probes concurrently and does not resolve readiness early', async () => {
    const releases: (() => void)[] = [];
    const query = vi.fn(() => new Promise<void>(resolve => releases.push(resolve)));
    let ready = false;
    const warmup = warmReadPool(query, 4).then(() => { ready = true; });
    expect(query).toHaveBeenCalledTimes(4);
    expect(ready).toBe(false);
    releases.slice(0, 3).forEach(release => release());
    await Promise.resolve();
    expect(ready).toBe(false);
    releases[3]!();
    await warmup;
    expect(ready).toBe(true);
  });
  it('settles every probe and redacts underlying connection failures', async () => {
    let release!: () => void;
    const query = vi.fn()
      .mockRejectedValueOnce(new Error('secret database connection'))
      .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const result = warmReadPool(query, 2);
    const assertion = expect(result).rejects.toThrow('DATABASE_WARMUP_FAILED');
    release();
    await assertion;
  });
  it('does not execute any probe when disabled', async () => {
    const query = vi.fn();
    await warmReadPool(query, 0);
    expect(query).not.toHaveBeenCalled();
  });
});
