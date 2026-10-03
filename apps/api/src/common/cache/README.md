# Short-lived API cache

Import `CacheModule` once in the root module. `CacheService` is global; it uses
`REDIS_URL`, `CACHE_NAMESPACE` (default `attendance-api`), `NODE_ENV`, and a hash
of the database host/path/user/schema to isolate keys. Set a distinct namespace
for different servers sharing the same database but using different policies.
Without a database identity, keys are isolated per process. Credentials are
never included in Redis keys or logs.

```ts
const key = { prefix: `worker-projects:${organizationId}:${employeeId}`, key: 'list' };
const projects = await cache.getOrLoad(key, 15_000, loadProjects);
// After the authoritative transaction commits:
await cache.invalidatePrefix(key.prefix);
```

TTL arguments are milliseconds, capped at 30 seconds. Prefix invalidation is an
exact group version rotation, not a wildcard or scan. Include the organization,
project, chat, and verified Telegram ID in membership keys; include all inputs
that affect a read model. Never cache session tokens, initData, coordinates,
credentials, or a marked principal. Cache JSON-safe, explicitly selected fields.
There is no local value fallback. Pending loaders are shared for at most one
second, with a maximum of 512 tracked entries. Failures and completed promises
are removed; long loaders still finish for their original callers.

Redis commands have a 40ms deadline (`CACHE_REDIS_TIMEOUT_MS`, clamped to 5–50ms).
Offline queuing and command retries are disabled. Non-ready Redis connections
are bypassed immediately. Background reconnects back off from 1 to 30 seconds;
HTTP requests never wait for reconnect. Command failures bypass Redis for one
second. Each getOrLoad uses up to two reads and one write; loader/database time
is separate. Values expire from before the load began, so slow work cannot
extend stale data. Corrupt entries are treated as misses and loader errors
propagate. There is no stale-on-error authorization fallback.

`invalidatePrefix` returns false if Redis could not confirm invalidation. On
that process all cache reads are bypassed for 30 seconds; other processes can
retain entries until their bounded TTL. Callers requiring immediate correctness
must revalidate in the database. Version keys live 60 seconds, longer than any
value; a late loader writes only to its original version and cannot repopulate
the newly invalidated version. Existing requests may still finish with their
already-started snapshot, as with ordinary concurrent DB reads.

## Session and authorization boundaries

Telegram HMAC verification runs on every session request before cache access.
The endpoint accepts no explicit organization selection. A verified Telegram ID
and bot ID first resolve an identity-only tenant pointer with a 15-second TTL;
profile entries additionally include organization, employee, Telegram ID, and
the discovery epoch. Discovery fails on multiple active accounts and never
chooses an arbitrary tenant. The selected fields contain account/employee state,
display profile, position, and organization summary only. Negative results and
errors are not cached. Owner bootstrap remains outside the read cache. Background
profile updates run only after a database resolution, so a warm session performs
no database reads or writes; profile metadata can lag by the same 15-second bound.

Session resolution can reflect pre-revocation state for at most 15 seconds and
can issue a token during that interval. That token cannot bypass the guard:
every protected request still checks active account, employee, and tenant in
the database. GET/HEAD guards use only in-flight query coalescing; they do not
cache completed authorization results. Mutations always run their own fresh
query, including when an identical GET is pending. Admin roles are refreshed
from the database with the same rule.

After the fresh worker check, `markVerifiedWorker(principal)` records the exact
server-created principal in a WeakSet. Project authorization may call
`isVerifiedWorker(principal)` to reuse that request's successful identity check.
It must still check project/site/membership authorization. The mark is not a
token claim, is not serializable, and does not survive copying the principal.
Do not reuse principal objects across requests or background jobs.

The cached-session latency target is under 500ms. Unit tests verify a warm path
with no account read and a bounded stalled-Redis path; deployment latency still
requires measurements against the actual API, Redis, and PostgreSQL services.
