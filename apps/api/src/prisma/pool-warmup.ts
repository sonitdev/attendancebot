/** Warm only a small part of the existing pool; never increase its connection limit. */
export function poolWarmupQueries(databaseUrl: string, configured?: string): number {
  const requested = configured === undefined ? 4 : Number(configured);
  const count = Number.isInteger(requested) && requested >= 0 ? Math.min(4, requested) : 4;
  try {
    const limit = Number(new URL(databaseUrl).searchParams.get('connection_limit'));
    return Number.isInteger(limit) && limit > 0 ? Math.min(count, limit) : count;
  } catch {
    return 0;
  }
}

/**
 * $connect opens one connection. Concurrent first requests can otherwise wait
 * for more TLS/database handshakes. Finish these read-only probes before listen.
 * No sleep, transaction, tenant data, or business mutation is involved.
 */
export async function warmReadPool(query: () => PromiseLike<unknown>, count: number): Promise<void> {
  const results = await Promise.allSettled(Array.from({ length: count }, async () => await query()));
  if (results.some(result => result.status === 'rejected')) throw new Error('DATABASE_WARMUP_FAILED');
}
