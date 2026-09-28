# Product Requirements

## Personas

- **Worker:** Telegram Mini App only; sees current assignment, checks in/out, and views own basic history.
- **Owner/HR:** manages organization workforce and reviews attendance/reporting.
- **Project Manager:** authorized-project visibility and assignments.
- **Site Manager:** authorized-site attendance, exceptions and assessments.
- **Engineer/Supervisor:** authorized observations only.

## MVP functional requirements

1. HR can create an active employee, project, site, work schedule and dated assignment.
2. A worker can link exactly one verified Telegram account through an audited administrative flow.
3. The worker's app resolves one valid assignment automatically. Multiple valid assignments must produce a clear, defined selection/review outcome, never a guess.
4. Check-in/out submits location evidence and is confirmed only after the API response.
5. The API validates Telegram identity, employee state, assignment, site/project states, schedule, GPS accuracy, geofence distance, duplicate attempts and idempotency.
6. Attendance records retain check-in/out facts, verification outcome, work duration and full event history.
7. Authorized managers can see today's site attendance and exceptions; workers cannot see other workers.
8. Daily/weekly reporting derives from source records, not stored manually-maintained totals.

## Explicit constraints

- Worker UX is: open, tap check-in, work, tap check-out.
- GPS is captured only at check-in/out in V1.
- Manual attendance and corrections are exceptional, authorized, approval-aware and auditable.
- Location accuracy affects verification confidence; browser coordinates cannot claim to be unspoofable.
