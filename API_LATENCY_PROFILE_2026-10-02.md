# API latency profile — 2026-10-02

## Verified update — 2026-10-03, Asia/Phnom_Penh

The preliminary investigation below is retained as historical context, not current status. The following evidence supersedes its pending-measurement and transaction-method statements.

### Startup bottleneck reproduced

User logs at 09:44 show session 1,220.51 ms (one DB operation 1,208.15 ms), projects 3,072.90 ms (authentication 2,542.50 ms, handler 529.24 ms), and today 3,130.77 ms (authentication 2,540.55 ms, handler 589.37 ms). All returned 200. Concurrent authentication is coalesced; its DB operation is attributed to the originating request, so the second request's DB counter does not include all its authentication wait. Nested spans are not additive.

The Mini App's first uncached render waits for Telegram SDK, session exchange, then today. Projects loads alongside today. The old single loading message called all these stages authentication; it now distinguishes Telegram connection, authentication, and attendance loading. This is diagnostic clarity, not a claimed latency improvement.

At approximately 09:55, a separate Prisma client against the configured database ran only SELECT 1:

| Probe | Wall duration |
| --- | ---: |
| Initial connect | 2,105 ms |
| First SELECT | 540 ms |
| Two parallel reads, A | 2,739 ms |
| Two parallel reads, B | 268 ms |
| Same parallel reads on warmed pool | 307 ms each |

This reproduces multi-second first-concurrency latency without business SQL. It strongly supports cold pool expansion/connection establishment as a contributor to the 2.54-second authentication wait; it does not prove every millisecond of that request had this cause. Moving work off the response path does not remove contention: session profile sync and outbox processing still share the Prisma pool.

Applied: before API readiness, PrismaService now awaits up to four concurrent read-only SELECT 1 probes. DATABASE_WARMUP_QUERIES can reduce or disable these; a smaller explicit connection_limit is respected. This does not increase the configured pool capacity or read/write tenant data. Failure logs are sanitized and retain the prior availability policy. More-than-warmed concurrency or connections retired after idle can still incur setup cost.

A fresh-client verification at approximately 09:59 invoked the actual warmReadPool helper:

| Probe | Wall duration |
| --- | ---: |
| Initial connect | 2,084 ms |
| Four-probe startup warmup | 2,517 ms |
| Following nine reads, three concurrent per wave | 254–275 ms |

The extra startup time happens before listening rather than during the first worker request. These are small-sample connection probes, NOT phone startup latency, authenticated HTTP p95, or check-in performance acceptance.

### Redis runtime is not ready

The current configuration points to local Redis port 6379. A direct TCP check returned ECONNREFUSED, and Docker reported its daemon socket absent. Therefore Redis caching and BullMQ cannot provide their intended warm-path benefits. The durable database fallback remains present; the repeated producer warning is noisy and does not establish a failed attendance request. No Redis/Docker startup or automatic notification resumption was performed by this investigation. User clarification/approval for service startup is pending.

### Earlier read-only measurements after query consolidation

Twenty serial samples per probe on 2026-10-03 at approximately 08:48–08:49, Node 26.6.0 / Prisma 6.19.3, configured Supabase shared pooler in ap-southeast-2, port 5432:

| Probe | Median | Small-sample p95 |
| --- | ---: | ---: |
| SELECT 1 | 267.892 ms | 278.093 ms |
| Active-worker guard read | 268.556 ms | 279.048 ms |
| Projects service, excluding guard | 269.360 ms | 314.749 ms |
| Today service, excluding guard | 271.513 ms | 480.100 ms |
| Joined assignment helper | 270.351 ms | 292.694 ms |

These are not endpoint measurements. The actual script uses reviewed SELECT-only operations through a write-rejecting client proxy, not a long database READ ONLY transaction: the earlier transaction probe failed before sampling. Reads include pool/network overhead. Plans redact predicates and values. Existing assignment/date, organization/employee, project/date and Telegram lookup indexes were inspected; no additional live index migration was executed. Tiny sampled tables and sub-millisecond inspected plans do not explain hundreds of milliseconds of client wall time. Broader load testing is still required.

### Implemented code and remaining release gates

- Joined worker reads preserve the already-loaded attendance instead of issuing a redundant lookup. Mutation context and replay reads are consolidated and tenant-scoped.
- One atomic PostgreSQL statement commits attendance, immutable event, idempotency request, audit and durable notification intent. Isolated PostgreSQL tests verify rollback/constraints; they are not production multi-connection load tests.
- Outbox/BullMQ processes Telegram and sales follow-up outside the attendance response. Uncertain non-idempotent Telegram outcomes are held for review rather than automatically duplicated.
- Redis caches session resolution (15 seconds), projects (15 seconds), today (2 seconds), and membership (up to 30 seconds). Keys include database/environment and worker/organization scope where applicable. Telegram HMAC and fresh worker revocation checks remain enforced; an unavailable Redis bypasses caching.
- Request IDs and server/browser timing distinguish authentication, DB, storage, GPS, photo rendering and background work. No tokens, raw coordinates or SQL parameters are logged by the new timing code.
- GPS acquisition overlaps explicit camera capture, without continuous tracking. Attendance success uses the authoritative response, not a blocking today refresh.
- The forward-only SALES_REPORT enum migration exists but has NOT been applied to the live database. Review/apply this prerequisite before using the new sales checkout follow-up path. Do not blindly deploy unrelated pending migrations in this dirty checkout.
- Current checks: 34 API test files / 298 tests pass; Prisma schema validation, diff whitespace check, and workspace typechecks pass. Contracts were rebuilt for the new startup labels before the successful typecheck.
- Lint remains blocked by existing missing ESLint configuration (API ESLint 9; Next lint requests interactive setup). No phone, live attendance write, Storage upload, or Redis worker integration benchmark is claimed.

Targets for cached endpoint p95 and check-in below one second remain UNVERIFIED. Keep the API/database network path short and measure actual authenticated traffic after restart and Redis restoration before declaring the performance task complete.

## Preliminary baseline (fresh database measurements pending)

Read-only investigation in `/Users/sonit/attendace_bot`. The application is being edited concurrently by the parent agent. This report distinguishes supplied logs, inspected source, historical measurements, and fresh profiler evidence. No application code, configuration, migration, session, attendance record, or Telegram state is changed by this investigation.

### User-supplied runtime evidence

The user supplied the following logs from **17:23 on 2026-10-02**. These are individual reported observations, **not measurements collected by this profiler**, medians, or p95 values.

| Operation | Reported duration |
|---|---:|
| Session | 1,289 ms |
| Connected projects | 541 ms |
| Worker today | 1,034 ms |
| Check-in | 8,757 ms |
| Worker today after check-in | 514 ms |

The handler latency interceptor excludes the authentication guard and browser GPS collection; these numbers must not be treated as end-to-end worker latency. No fresh session or check-in benchmark will be attempted because those paths can write state or call external services.

### Source baseline and concurrent work

At inspection, `readWorkerAssignments()` already joins today's attendance using the site's timezone. However, `getWorkerToday()` builds candidate objects containing only assignment/date/site/schedule fields. It drops `row.attendance`, so the later `record === undefined` branch issues an additional `AttendanceRecord.findFirst()` SELECT. The parent agent is fixing this defect; this investigation will not edit the service.

The joined helper alone and the complete worker-today service therefore need separate query counts and timings. A one-query helper does not establish that the service or authenticated endpoint uses one query.

The session source already contains a joined identity read, so descriptions of older multi-query session behavior are historical. Session creation itself also performs writes and is excluded from replay.

Mutation-path source opportunities observed: current-project relation reads, repeated project/account/connection authorization reads, assignment/site/schedule relation reads, idempotency lookup, and open-attendance relation reads. Only SELECT equivalents and their plans will be profiled. External membership verification, Storage upload, transaction commit, outbox claims, and Telegram delivery remain unmeasured.

### Fresh probe status

The repeatable profiler is `scripts/performance-readonly.mjs`. Syntax and offline safety/percentile self-checks passed. The first sandbox run at **10:27:21 UTC / 17:27:21 Asia/Phnom_Penh** failed during connection setup, before collecting database timings. Network escalation is the next step; no fresh median/p95 is claimed yet.

That run captured the current read methods in memory, avoiding imports of Nest application modules, bot lifecycle hooks, or mutating services. Source SHA-256 fingerprints:

| File | SHA-256 |
|---|---|
| `apps/api/src/attendance/worker-read-model.ts` | `f9859118cf5afc01aa148396326242a57c4c69e463695b793bca3383e94d9961` |
| `apps/api/src/attendance/attendance.service.ts` | `4d4d807d96095ee594f4de47773db0e0110a9730e84c4854a924a986a549672f` |
| `apps/api/src/auth/guards/auth.guard.ts` | `d1eb139b371eb328bc818860a4d3b12ae5809fa89f8279419e9bd85599c4c9cb` |

These hashes identify source versions, not user records. Subsequent measurement runs will record their own fingerprints and whether files changed during sampling.

### Configuration observations (local file inspected privately)

- `DATABASE_URL` was parsed with dotenv in memory. No environment values, credentials, database/account identifiers, SQL parameters, or coordinates are printed.
- Host class: Supabase shared pooler; hostname region label: `ap-southeast-2`; port 5432; `sslmode=require`.
- `DIRECT_URL` points to the same host/port. Its name alone does not establish a direct database connection.
- URL options `connection_limit`, `pool_timeout`, and `connect_timeout` are absent; `pgbouncer=true` is absent. This establishes configured options only, not effective pool capacity or saturation.
- Profiler runtime: local macOS arm64, Node 26.6.0, Prisma 6.19.3. Deployed API region and physical network route are unverified. A distant endpoint is a hypothesis to measure, not proof of a particular network cost.

### Measurement contract

Planned: 25 serial samples per core read, two warmups each, rotating probe order. Report median and nearest-rank p95 (`ceil(0.95 × n)`, the 24th ordered value for 25 samples), ranges, raw safe wall timings, and observed SELECT counts. An empirical p95 from 25 samples is a small-sample estimate, not a production latency SLO.

All business reads, catalog reads, and SELECT-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` run inside a database-enforced READ ONLY transaction. A client proxy also rejects write methods and non-SELECT raw SQL. The transaction pins one connection; results exclude request pool acquisition, HTTP, token verification, and transaction setup/teardown. They cannot establish concurrent throughput or API p95.

Plans retain numeric timings/rows/buffers and structural table/index names. Predicate/output/sort expressions are redacted in full so constants never escape. Errors omit messages, stack traces, SQL, URLs, and parameters. Mutation-path SELECT diagnostics will be labeled separately from mutation latency.

### Historical references, not fresh baselines

`MINI_APP_ARCHITECTURE_PERFORMANCE_AUDIT_2026-10-02.md` and `PERFORMANCE_FIXES_2026-10-02.md` report five-sample measurements from earlier source: today service 7 then 2 SELECTs, projects 3 then 1 SELECT, and trivial-query medians 353.65 then 257.04 ms. The source and network conditions changed between those runs; those numbers are not current measured medians/p95 and do not isolate the effect of the ongoing implementation.

### Preservation and rerun

Required AGENTS documents were read in order; deleted `PAGE_PLAN.md` was read through `git show HEAD:PAGE_PLAN.md` without restoring it. The very dirty worktree remains owned by the user/parent. Only this report and the profiling script are writable task artifacts.

```sh
node scripts/performance-readonly.mjs --self-test
node scripts/performance-readonly.mjs --samples=25
```

The script prints sanitized JSONL to stdout and writes no files. It reads current source each run; run it again after the parent finishes changes for a separately labeled after measurement. No server boot, migration, Telegram API, session exchange, or attendance submission is required.
