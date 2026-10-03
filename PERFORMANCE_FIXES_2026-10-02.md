# Attendance Mini App — implemented performance fixes

Date: 2026-10-02. Follow-up to `MINI_APP_ARCHITECTURE_PERFORMANCE_AUDIT_2026-10-02.md`.

## Outcome

This is a focused implementation pass, not a framework rewrite or an assertion that every endpoint is instant. Existing unrelated worktree changes were preserved. No migration, production write, deployment, Telegram configuration change, or attendance submission was performed.

| Measurement | Before | After | Conditions |
|---|---:|---:|---|
| `getWorkerToday` service median | 1,958.58 ms | 514.60 ms | Five sequential samples per version; actual Supabase connection; service only, excludes HTTP/auth guard |
| Database SELECTs per today service call | 7 | 2 | Query event instrumentation |
| Connected-project service median | 814.26 ms | 307.40 ms | Five sequential samples per version; same read-only worker context |
| Database SELECTs per projects service call | 3 | 1 | Query event instrumentation |
| Next production First Load JS | 162 kB | 136 kB | Build-reported route `/`, shared chunks included |
| Next production route-specific JS | 60.3 kB | 33.5 kB | Same framework/dependencies |

Read-only after samples (ms):

- Today: 1042.41, 514.60, 545.14, 514.10, 513.57.
- Projects: 610.92, 357.75, 307.40, 255.61, 256.28.
- `SELECT 1`: 629.54, 257.04, 255.59, 305.21, 256.63.
- Guard-equivalent query: 596.08, 279.09, 259.89, 287.25, 295.57.

Environment: local macOS arm64, Node 26.6.0, pnpm 9.15, Next 15.5.25, Prisma 6.19.3, existing Supabase session pooler in ap-southeast-2. Before and after are separate runs, not randomized concurrent benchmarks. Network conditions varied: `SELECT 1` median was 353.65 ms before and 257.04 ms after. Reduced query counts are confirmed; the entire wall-time difference cannot be attributed solely to code.

## What changed

### Backend reads

- `apps/api/src/attendance/worker-read-model.ts`: joined, parameterized, tenant-scoped queries for the current project/assignments/sites/schedules and connected projects.
- `AttendanceService.getWorkerToday`: uses the joined read plus one narrowly selected attendance read. The attendance read explicitly includes organization and employee predicates.
- `AttendanceService.listConnectedProjects`: one query instead of three relation queries.
- Existing site-local assignment dates, ambiguity rejection, and legacy single-assignment fallback are preserved. Check-in/out authorization, official timestamps, database transactions, and outbox delivery rules are unchanged.

### Submission reliability and cleaner responsibilities

- `src/lib/attendance-submission.ts`: reusable submission/reconciliation helper; confirmed server timestamps and statuses immediately update the screen.
- Optional haptic-feedback failures no longer enter the failed-submission path.
- Slow refreshes do not block success. Read-version checks discard obsolete responses.
- Timeout/network/server failures are reported as unconfirmed rather than falsely claiming the record was not saved. A read-only refresh can confirm a newly saved check-in/out and show success.
- Rapid repeated taps are guarded. A retry in the same mounted page reuses the original idempotency key and payload after an uncertain response. No automatic mutation retry was added.
- The retry state is in memory only. Reloading the app loses it; server constraints/idempotency remain essential. Visit outcomes are not inferred from today's attendance state.
- `src/lib/api.ts`: concurrent identical reads are coalesced per token; writes invalidate in-flight read reuse. The existing 20-second timeout now covers response-body reading too. HTML responses are not accepted as successful JSON results.

### Initial load and rendering

- Telegram SDK loads asynchronously so its download no longer blocks HTML parsing. `telegram-session.ts` explicitly waits for it and coalesces concurrent session-verification calls without caching authentication across launches.
- Removed eager GSAP page animation and its initial bundle cost. Existing appearance, fonts, and interactive styles remain.
- Camera clock moved into a leaf component: one-second updates no longer re-render the entire attendance page. Cancelled camera requests now stop returned streams.
- Removed the arbitrary six-second forced exit from loading.
- Cached attendance previews are shown only after server session verification, for the same organization/worker, within 60 seconds and the same site-local date. Legacy persisted session tokens are cleared instead of restored.
- Project-list loading is independent of today loading. The attendance screen is released before optional sales details finish loading.

## Verification

- Contracts build passed.
- API and Mini App TypeScript checks passed.
- API build passed in an isolated copy.
- Mini App production build passed in an isolated copy.
- 45 focused checks passed across current-project, check-in, check-out, RBAC, and Mini App submission/transport/cache tests. Existing attendance fixtures are synthetic; no live writes were used.
- `git diff --check` passed.
- Local anonymous production browser smoke check: successful page load, no observed console errors, no long tasks or layout shifts during the observation window. First contentful paint samples: 100, 84, 72 ms; observed LCP: 172, 84, 72 ms. Telegram SDK/fonts were warm or potentially cached, so these are not a controlled cold-load improvement claim and not authenticated phone timings.
- Browser-observed initial app JS: 136,257 encoded bytes across six files (excluding SDK and temporary instrumentation), versus 163,154 across seven in the audit.

Build/profiling work used `/private/tmp/attendance-audit-sVzcew`. The browser timing script and its extra layout script tag exist only in that isolated copy; no profiling code was added to the application. The temporary browser tab and port-15130 server were closed after verification. The frontend-design skill guided keeping loading feedback clear without changing the requested visual identity.

## Using the changes

Changes are in the working repository, not deployed. Contracts were rebuilt locally. Restart the API and Mini App development processes to ensure they load the updated source; close and reopen the Telegram Mini App. Production requires the normal approved build/deployment process. No database migration is needed for this patch.

The audit report contains the full architecture and baseline. This patch does **not** resolve or verify:

- End-to-end phone check-in latency, Telegram delivery, approval messages, or public ngrok reachability.
- Physical camera/GPS behavior on Android/iOS.
- Font transfer optimization: the requested TTF fonts are unchanged. No font conversion dependency was installed.
- The remaining database network floor (roughly 257 ms per trivial query in the after run), synchronous authorization/Storage latency in mutation paths, or every admin endpoint.
- Large sales/page component decomposition beyond the extracted SDK, submission, SQL read, and camera-clock responsibilities.

Next implementation priorities: instrument and bound authorization/Storage calls on the mutation path; optimize self-hosted font transfer without changing glyphs/weights; apply measured joined reads to the slowest admin endpoints. Keep deployment and live database changes behind an explicit approval gate.
