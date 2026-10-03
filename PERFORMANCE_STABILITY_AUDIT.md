# Performance and Stability Audit

Updated 2026-09-29. This document records repository-verifiable findings; live Telegram, browser, device, Supabase, and production database measurements remain separate acceptance gates.

## Verified improvements

- Admin dashboard data orchestration is isolated in `apps/admin/src/app/operations/use-operations-data.ts`; KPI rendering is reusable in `operations-kpis.tsx`.
- Workforce data loading is tab-aware in `apps/admin/src/app/workforce/use-workforce-data.ts`.
- Mini App startup restores validated cache immediately and loads connected projects/today data in parallel.
- Admin and Mini App API clients have bounded request deadlines.
- Attendance and employee list endpoints do not sign Supabase evidence URLs per row. Detail views sign on demand.
- Sales evidence signing uses a 240-second in-process cache, concurrent-request deduplication, and a 500-entry bound.
- Telegram outbox and health synchronization use bounded concurrency; health checks have an 8-second request deadline.
- Telegram delivery claims have a tenant-scoped composite index on `(organizationId, status, nextAttemptAt, createdAt)`.
- Admin attendance reads have a matching `(organizationId, attendanceDate, createdAt)` composite index and forward-only migration.
- Workforce presentation has reusable boundaries for the page header, employee controls, expandable assignment cards, and project/site controls; the main Workforce page is now 2,544 lines (down from 2,736 before the extraction pass).

## Verification evidence

- API automated tests: 25 files, 161 tests passed.
- Workspace typechecks passed for contracts, API, Admin, and Mini App.
- Production builds passed for contracts, API, Admin, and Mini App.
- Prisma schema validation passed.
- Focused Telegram, attendance, analytics, visit, and outbox suites passed after the performance changes.
- `git diff --check` passed.

## Local runtime smoke evidence

The existing local production servers were reachable on ports 5132 (Admin) and 5130 (Mini App). Representative unauthenticated HTTP requests returned `200`:

| Surface | Route | Total time |
|---|---|---:|
| Admin | `/` | ~93 ms |
| Admin | `/workforce` | ~84 ms |
| Admin | `/attendance` | ~441 ms |
| Admin | `/sales` | ~263 ms |
| Admin | `/settings` | ~234 ms |
| Mini App | `/` | ~7 ms |

The local NestJS API health endpoint `/api/v1/health` returned `{"status":"ok"}` in ~4 ms. The unauthenticated API root and health aliases outside the `/api/v1` prefix returned 404 as expected; no protected endpoint was probed without credentials.

These are local unauthenticated document timings, not production RUM, authenticated API latency, database timings, or device camera/GPS timings.

## Remaining acceptance gates

- Browser waterfall and interaction profiling for Admin routes.
- Physical Telegram Mini App camera/GPS and device-network testing.
- Live Telegram Bot API health and outbox delivery testing.
- Production-like PostgreSQL `EXPLAIN ANALYZE` using representative tenant data.
- Supabase Storage signed URL latency/expiry verification against the deployed bucket configuration.
- Deeper extraction of the remaining large Workforce tab and Mini App camera/attendance render sections.
# Follow-up latency remediation — 2026-09-29

The supplied Admin development logs show that Next.js page rendering is not the bottleneck (roughly 14–132ms); the API/database path is. The slowest repeated requests are `attendance/today` (1.8–3.9s), `attendance/exceptions` (3.8–4.1s), and `assignments` (1.3–2.9s), with a broad 0.5–1.1s floor across small reads.

This pass reduced the two hottest attendance response queries to only the fields used by their contracts. The today query no longer loads the unused evidence path or duplicate assignment-site relation. The exceptions query no longer loads full Site, Project, Assignment, Schedule, or Correction rows. Three forward-only indexes were added for organization/date/status, organization/date/adjusted-status, and organization/adjusted-project/date filtering. These preserve organization and admin-scope predicates.

Verification completed: API typecheck, all 161 API tests, repository typecheck, Prisma schema validation, and `git diff --check`. The new migration must be applied in the target database before its index benefit can be measured. A fresh latency sample after migration is still required; no claim of a specific production percentage improvement is made yet.
