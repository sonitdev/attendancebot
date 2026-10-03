# Attendance Portal — Handoff for Antigravity

Date: 2026-09-28
Repository: `/Users/sonit/attendace_bot`

## Mission

Complete the attendance portal against `TELEGRAM_ATTENDANCE_MASTER_SPEC.md`, `MASTER_PLAN.md`, and the user’s master task. The system has two connected products:

1. Admin portal: configure projects, sites, schedules, workers, assignments, Telegram groups, corrections, reports, security, company branding, and sales operations.
2. Telegram bot + Mini App: authenticate the Telegram worker, select a connected project, capture live camera proof for check-in/visits, capture GPS, submit authoritative attendance, and support Field Sales daily reports.

All business decisions belong in NestJS/API and PostgreSQL. Supabase is storage/database infrastructure only; it must not replace the NestJS business layer.

## Current user boundary

The user explicitly asked to defer tests and focus on implementation. Do not run tests, lint, typecheck, build, Prisma validation, browser QA, or device QA in the next continuation unless the user explicitly changes this instruction. Static inspection with `rg`, `sed`, `git diff`, and targeted source reading is allowed. Do not report anything as “verified” until that later verification phase happens.

Preserve the dirty worktree. Do not reset, clean, overwrite, commit, push, or revert unrelated work. Use `apply_patch` for edits.

## Non-negotiable engineering rules

- NestJS is the authoritative business layer.
- Only the server determines official attendance timestamps and final status.
- Verify Telegram Mini App `initData` on the server for every worker session.
- Verify live Telegram group membership with `getChatMember` whenever a worker selects a project, opens a protected operation, checks in, records a visit, or completes a registration/project connection.
- Calculate geofence distance and location reliability on the server. Browser GPS is evidence, never authority.
- Every organization-scoped read/write must enforce `organizationId`.
- RBAC and project/site scope checks are server-side. UI hiding is not authorization.
- Preserve raw attendance events, original timestamps, GPS, photos, corrections, overrides, and audit history. Approved corrections use explicit adjusted fields; never rewrite raw facts.
- Keep attendance facts separate from performance assessments. Do not infer discipline, promotion, or firing recommendations.
- Workers see only their own assignment, visits, reports, and attendance. Do not add continuous tracking in V1.
- Use idempotency plus database constraints for check-in, check-out, visits, and report writes.
- Store timestamps in UTC and display them in the assigned site’s IANA timezone.
- Never log or commit secrets, service-role keys, Telegram `initData`, or raw coordinates unnecessarily.
- Validate all external input at API boundaries with shared contracts.
- Archive business records; do not hard-delete projects, employees, sites, attendance, visits, or evidence.
- All user-facing copy must come from `packages/contracts/src/km.ts`; source code remains English. Do not hardcode Khmer strings in app/API files.

## What is already implemented in this worktree

### Database and contracts

- `prisma/schema.prisma` includes project work mode (`SITE`/`SALES`), Telegram connection health, worker-project authorization metadata, immutable attendance source plus adjusted fields, outlets, daily sales reports, report visits, Telegram conversation state, organization branding, and archived project status.
- Migration: `prisma/migrations/20260928000800_complete_security_sales_foundation/migration.sql`.
- Earlier forward-only migrations add visits, Telegram report groups/destinations, current project, pending project selection, delivery outbox, and visit context.
- Shared schemas/types live in `packages/contracts/src/index.ts`.
- Khmer UI/bot copy lives in `packages/contracts/src/km.ts`.

### Central authorization and worker API

- `apps/api/src/auth/project-authorization.service.ts` centralizes live Telegram membership checks and worker-project authorization. It updates project health and worker authorization metadata and writes denial audit rows.
- `apps/api/src/attendance/attendance.service.ts` requires that authorization for current-project switching, check-in, and visits. Worker connected-project results include `workMode`.
- Check-in requires compressed camera proof and GPS; check-out requires GPS but no photo.
- Attendance project/chat/site identity is frozen on the record. Telegram evidence delivery uses the frozen chat through the outbox.
- `AttendanceRecord.adjustedCheckInAt`, `adjustedCheckOutAt`, `adjustedStatus`, and `adjustedProjectId` preserve correction results without mutating raw facts.
- `apps/api/src/attendance/correction.service.ts` snapshots originals, proposes corrections, and resolves approval/rejection with audit/event history.

### Telegram lifecycle

- `/connect` creates a pending project/report-group identity; it must be deliberately configured by an admin before activation.
- Pending project selection is revalidated when applied during registration/approval.
- `TelegramBotService` has the private sales report assistant: missing visit context, worker’s original statement, report note, and submit actions.
- Check-out on a SALES project prepares a daily report flow.

### Field Sales

- `apps/api/src/sales/sales.service.ts`, `sales.controller.ts`, and `sales.module.ts` provide outlet CRUD, worker outlet listing, sales-day/report read/write, visit context, report submission, and admin overview.
- A sales visit requires an open attendance, current SALES project, authorized group membership, GPS, photo proof, and idempotency key.
- Visits are linked to `attendanceRecordId`; daily reports are tied to the same attendance record.
- `apps/telegram-mini-app/src/app/page.tsx` now branches by `currentProject.workMode`: SITE shows check-in/check-out; SALES shows start/end work, outlet selection, visit photo/GPS capture, visit context, and daily report controls.
- `apps/telegram-mini-app/src/lib/api.ts` contains sales-day, outlet, visit-context, report-save, and report-submit calls.

### Admin portal

New pages:

- `/attendance`: exception/evidence review, correction proposal, pending correction approval/rejection.
- `/sales`: sales operational overview.
- `/reports`: filtered attendance export.
- `/security`: audit/security events.
- `/settings`: organization name, logo upload, brand colors, and locale.
- `/telegram-reporting`: Telegram group destination configuration.

Admin endpoints now include project/employee detail, settings/logo, security events, sales overview/outlets, correction resolution, and Telegram project health refresh (`POST /projects/:id/telegram-health`).

`AdminShell` reads organization settings and applies branding CSS variables/logo. Keep this shared-shell behavior; do not create page-specific brand forks.

The frontend direction follows the loaded frontend-design skill: calm operational hierarchy, restrained premium spacing, clear state chips, evidence-first cards, and focused actions rather than decorative dashboard noise.

## Remaining implementation work, in order

### 1. Finish the worker Sales UX

- Inspect the Mini App source statically for all new state paths and ensure the SALES branch does not render site-only wording or actions.
- Add optional structured fields to the visit UI: result, follow-up, potential order quantity, requested discount, and outlet/customer distinction. Keep all labels in `km.ts`.
- Add signed proof-photo viewing for the worker’s own sales report only if needed; never expose storage paths directly.
- Ensure `getWorkerSalesDay` selects the current site-local workday/open attendance, not an arbitrary latest historical record.
- Ensure report submission requires checkout and complete visit context; preserve the worker’s exact original statement alongside structured fields.
- Keep camera capture facing the environment. The fallback input uses `capture="environment"`; do not describe a gallery-selected image as equivalent to a live capture.

### 2. Finish admin operational workflows

- Add project detail and employee detail pages or clearly link the existing API endpoints from workforce cards. Include project history, Telegram health, worker connections, attendance history, and access-denial events.
- Add a visible “refresh Telegram health” action on project detail/reporting. Surface `CONNECTED`, `BOT_REMOVED`, `PERMISSION_ERROR`, `PENDING`, last check, and safe error text.
- Add outlet management to the sales admin page (list/create/edit/archive) using `/sales/outlets`.
- Add a daily sales report detail view with visits, proof evidence, worker statements, follow-ups, order quantities, and discount requests.
- Add correction filters and evidence links; corrections must show original versus adjusted values and resolution note.
- Add report export fields for employee/project/site/status/effective times and exception-only filtering.

### 3. Close authorization and scope gaps

- Audit every admin controller/service query for organization scope and role enforcement.
- Add a persisted admin project/site scope model (for example `UserProjectScope`) if Viewer or manager scoping is required by the master spec. Enforce it in service queries, not only in navigation.
- Confirm viewer is read-only. Viewer must not mutate settings, corrections, outlets, assignments, or Telegram destinations.
- Add server-side protection for cross-project worker assignment reads and updates.
- Ensure inactive/archived projects, employees, sites, outlets, and worker connections cannot be selected for new work.
- Ensure current-project and check-in authorization fails closed on Telegram API failure.

### 4. Close historical integrity gaps

Search statically for queries using `assignment.site.project` or current assignment metadata when the authoritative attendance project should be used. Known location: `apps/api/src/analytics/analytics.service.ts`. Fix analytics, exports, dashboards, jobs, and detail views to use:

- raw frozen project/site/chat for source facts;
- adjusted project/time/status only where the user is explicitly viewing the effective corrected result;
- never assignment project metadata to reinterpret a historical attendance record.

### 5. Localize and clean the UI

- Replace remaining hardcoded English UI kickers/labels in the newly added pages with keys in `km.ts`.
- Keep enum/action identifiers in English internally; map them to Khmer at the presentation boundary.
- Remove duplicate translation keys and keep `km.ts` the only Khmer source.
- Use site timezone for sales/admin times instead of browser-local `toLocaleTimeString()`.
- Keep source code, variable names, route names, and database values English.

### 6. Storage and infrastructure configuration

- Ensure Supabase private bucket `attendance-evidence` exists and is private; signed URLs must be short-lived.
- Ensure public/private bucket `company-branding` exists according to deployment policy; do not make attendance evidence public.
- Confirm storage upload paths are organization/employee scoped and reject oversized/unsupported images.
- Keep service-role keys API-only and absent from browser bundles.

### 7. Seed and lifecycle completeness

- Inspect `prisma/seed.mjs` and seed all roles/permissions required by the master plan, including `VIEWER` read-only behavior.
- Ensure sample SALES project/outlets do not silently activate Telegram reporting.
- Ensure archived project/site/employee records remain queryable for history but disappear from active selectors.
- Ensure a project cannot be activated for reporting without an admin target and a healthy Telegram connection.

## Known static hazards to check before claiming implementation complete

- Do not run validation commands during this phase, but inspect carefully for constructor changes and import mismatches caused by the new services.
- `AdminService` constructor has `PrismaService`, `TelegramNotifierService`, and `ConfigService`; `AdminModule` imports `JobsModule`.
- `AttendanceService` depends on `SalesService`, `TelegramNotifierService`, `TelegramOutboxService`, and `ProjectAuthorizationService`; `AttendanceModule` imports `SalesModule`.
- `TelegramBotService` depends on `SalesService`; `TelegramModule` imports `SalesModule`.
- `ProjectAuthorizationService` is exported globally by `AuthModule`.
- `WorkerTodayResponse.currentProject` includes `workMode`; keep contracts and API response aligned.
- `WorkerConnectedProject` includes `workMode`; keep Mini App project picker aligned.
- Do not reintroduce a relation from `Organization` to `AttendanceRecord` using the `AdjustedAttendanceProject` relation name. That relation belongs to `Project`.
- Do not add duplicate `Site.visitLogs` relations.
- `apps/api/src/attendance/correction.service.ts` must retain the original-value snapshot and explicit adjusted-field write path.
- `apps/api/src/telegram/telegram-bot.service.ts` must not route slash commands into the conversational sales-report state machine.
- Avoid circular module imports. `SalesModule` should remain independent; `AttendanceModule` and `TelegramModule` consume it.

## Verification phase (later, only after user approves)

When the implementation phase is complete, run verification in a separate phase:

1. Prisma schema/migration review and generated-client consistency.
2. Focused API tests for auth, membership denial, project switching, check-in/check-out, visits, corrections, report submission, outbox retries, and organization isolation.
3. Frontend typecheck/build/lint.
4. Admin browser QA for each new route and responsive states.
5. Telegram Mini App/device QA for camera permission, live capture, GPS, multiple visits, checkout, and report assistant.
6. Supabase storage/RLS/secret review.
7. Update `SCENARIO_PROGRESS.md` only with evidence-backed statuses, then update `CURRENT_IMPLEMENTATION_AUDIT.md` with real percentages.

Do not claim 100% or “end-to-end complete” before this verification phase. The current scenario file still says Scenario 22 is in progress and the audit document is an old 50% snapshot; both must be refreshed after implementation and later verification.

## Completion handoff format

At the end of the next implementation session, report:

- files changed;
- business capability connected;
- static hazards resolved;
- remaining implementation blockers;
- explicit statement that tests/build/browser/device verification were not run because the user deferred them.

