# Continuation Brief (Updated)

## Product

A production-ready, multi-organization workforce site attendance system. Workers use a Telegram Mini App for a minimal check-in/check-out flow; management uses an admin portal. The trusted API is NestJS, with Supabase PostgreSQL/Storage and Redis/BullMQ.

## Completed Status

### Phase 0 — Foundation (Completed & Verified)
- Local `.env` with Supabase credentials and Telegram bot token (`@site_attendantbot`).
- `PrismaService` and `PrismaModule` with connection handling and multi-tenant scoping helpers.
- Organization-scoped principal/request context with HMAC-SHA256 session token issuance and verification.
- Global `AuthGuard` and server-side `RbacGuard` enforcing strict cross-organization denial (`FORBIDDEN_SCOPE`) and role/permission checks.
- `POST /api/v1/telegram/session`: validates Telegram Mini App `initData` server-side against bot token, resolves active linked employee and account, updates `lastVerifiedAt`, and issues safe worker session tokens.

### Phase 1 — Vertical Slice & Analytics (Completed & Verified)
- Authoritative server-side `schedule-evaluator.ts` with IANA timezone calculations, arrival status (`ON_TIME` vs `LATE`), departure status (`COMPLETED` vs `EARLY_CHECKOUT`), and duration in minutes.
- Admin setup endpoints (`POST /employees`, `POST /projects`, `POST /sites`, `POST /schedules`, `POST /assignments`, `POST /telegram/link`).
- Authoritative worker check-in (`POST /api/v1/attendance/check-in`) with Haversine distance, GPS accuracy evaluation, idempotency guarantees via `AttendanceRequest`, append-only `AttendanceEvent`s, and `AuditLog` creation.
- Authoritative worker check-out (`POST /api/v1/attendance/check-out`) with duration calculation and state transition.
- Admin daily attendance queries (`GET /api/v1/attendance/today`, `GET /api/v1/attendance/:id`).
- Profile identity capture: `photo_url`, `first_name`, `last_name`, and `username` extracted and persisted to `TelegramAccount` and `Employee.avatarUrl`.
- Cross-project performance analytics & complete history (`GET /api/v1/worker/analytics`, `GET /api/v1/worker/history`, `GET /api/v1/employees/:id/analytics`, `GET /api/v1/employees/:id/history`).
- Real database seeder (`prisma/seed.mjs`) executed against live Supabase PostgreSQL.

### Phase 2 — Worker Telegram Mini App (Completed & Verified)
- Mobile-first Next.js 15, React 19, and Tailwind CSS Mini App (`apps/telegram-mini-app`) integrated with `@site_attendantbot`.
- Telegram WebApp SDK initialization and automatic `initData` session exchange (`POST /api/v1/telegram/session`).
- Real worker profile avatar, name, and username display.
- Authoritative GPS check-in/out with 52px+ action button, one-shot HTML5 geolocation capture, Haversine verification, and clear state machine feedback (idle, capturing, verifying, confirmed, error).
- Cross-project analytics tab (`GET /api/v1/worker/analytics`, `GET /api/v1/worker/history`) displaying punctuality %, total hours worked across projects, and attendance timeline.
- Production Next.js build verified (`.next/`), 0 TypeScript errors.

### Phase 3 — Admin Management Portal (Completed & Verified)
- Modern Next.js 15, React 19, and Tailwind CSS administrative portal (`apps/admin`).
- Admin session management with HMAC-SHA256 tokens and `POST /api/v1/auth/admin-login` for verified management accounts (`admin@acme.com`).
- Live Operations dashboard (`/`) displaying real-time today's attendance records (`GET /api/v1/attendance/today`), KPI stat cards (Present, On-Time, Completed, Exceptions), and an attendance detail drawer with the full immutable `AttendanceEvent` timeline and GPS evidence.
- Workforce & Site Management (`/workforce`):
  - Employees directory, creation modal, and Telegram account linkage modal (`POST /api/v1/telegram/link`).
  - Projects & Sites directory, creation modals with coordinates, allowed radius, and IANA timezone.
  - Work Schedules directory and creation modal with shift start/end times and grace minutes.
  - Dated Employee Assignments directory and creation modal.
- Cross-project performance analytics (`/analytics`): worker on-time %, multi-project breakdown, and shift history.
- Immutable audit log viewer (`/audit`) displaying actor, timestamp, action, target, and formatted JSON metadata.

### Phase 4 — Background Jobs, Automated Evaluations & Telegram Bot Setup (Completed & Verified)
- Automated shift evaluations in `AttendanceJobsService` with timezone fidelity (`Asia/Phnom_Penh`):
  - Missing check-out review (`evaluateMissingCheckouts`): Scans unclosed shifts past shift end + grace period, safely flags status as `MISSING_CHECKOUT`, creates append-only `AttendanceEvent`s and `AuditLog`s, and dispatches push notices.
  - Absence detection (`evaluateAbsences`): Evaluates active assignments without check-in past shift start + grace + 1hr buffer, creates `ABSENT` records with full audit trail.
  - Shift reminders (`sendShiftReminders`): Dispatches push notices 15-30m before shift starts to linked Telegram accounts.
  - Daily operational reporting (`generateDailyReport`): Calculates punctuality %, present totals, and site-by-site breakdowns from source records.
- Admin management endpoints in `AdminJobsController` (`/api/v1/admin/jobs/*`).
- Push notification delivery via `TelegramNotifierService` with markdown formatting.
- Telegram Bot (@site_attendantbot) configuration script `scripts/setup-telegram-bot.mjs`:
  - Registered commands (`/start`, `/status`, `/help`).
  - Configured persistent chat menu button (`setChatMenuButton`) launching the Mini App.
  - Verified live with Telegram Bot API (`ok: true`).

### Phase 5 — Attendance Corrections, Exceptions & HR Reporting (Completed & Verified)
- Additive database schema: `CorrectionStatus` enum (`PENDING`, `APPROVED`, `REJECTED`) and `AttendanceCorrection` model synced to Supabase PostgreSQL (`aws-0-ap-southeast-2.pooler.supabase.com:5432`).
- Rule 7 & 8 Invariants: Original GPS evidence (`checkInLatitude`, `checkInLongitude`, `checkInAccuracyMeters`, `checkInDistanceMeters`, timestamps) is permanently preserved and never overwritten.
- Propose correction: Requires mandatory justification reason (min 5 characters); logs an immutable `AuditLog` entry and appends a `MANUAL_CORRECTION` attendance event.
- Resolve correction: Supports `APPROVED` (updates record status/duration, appends `MANAGER_OVERRIDE` event, records audit log) and `REJECTED` (leaves original record untouched, records audit log); prevents re-resolving already resolved proposals.
- Exceptions review endpoint (`GET /attendance/exceptions`): Lists flagged records (`OUTSIDE_GEOFENCE`, `MISSING_CHECKOUT`, `LOW_ACCURACY`, `LATE`, `PENDING_REVIEW`, `ABSENT`) and pending proposals.
- Multi-format HR export (`GET /attendance/export`): Generates RFC 4180 CSV or JSON with local site timestamps (`Asia/Phnom_Penh`) and duration calculations.
- Dedicated Admin Exceptions Dashboard (`/exceptions`):
  - Summary metrics banner: Unresolved Exceptions, Pending Approvals, Geofence Violations, Missing Checkouts.
  - Anomaly status filter pills and live worker search.
  - "Propose Correction" modal with mandatory justification reason.
  - Side-by-side evidence preview (original GPS distance/accuracy vs proposed adjustment).
  - Inline Approve/Reject controls for pending proposals.
- Admin Shell navigation: Added "Exceptions & Review" tab.
- Admin Analytics Export: One-click "Export Attendance CSV" button generating formatted payroll/HR records.

### Test Verification
- **86 automated tests passing** across 13 test suites (`vitest`).
- **0 TypeScript errors** across `@workforce/contracts`, `@workforce/api`, `@workforce/telegram-mini-app`, and `@workforce/admin` (`pnpm typecheck`).
- **Production builds passing** across all apps and packages (`pnpm build`).

## System Status
All primary development phases (Phase 0 Foundation, Phase 1 Vertical Slice & Profile Analytics, Phase 2 Worker Telegram Mini App, Phase 3 Admin Management Portal, and Phase 4 Background Jobs & Bot Setup) are **fully implemented, tested, and verified**.

## Non-negotiables (Always Enforced)
- NestJS owns all attendance business logic.
- Only the server determines official timestamps and final attendance status.
- Never trust browser Telegram identity or employee IDs.
- Client location is evidence only; geofence distance and accuracy run server-side.
- Multi-tenant isolation: every query/mutation enforces `organizationId`.
- Preserve attendance events, corrections, and audit history; never silently rewrite historical records.
- Attendance facts and human performance assessments stay separate (Rule 8).
- Workers are not continuously tracked.
- Never expose secrets or service-role keys.
