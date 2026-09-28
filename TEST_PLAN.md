# Test Plan

## Vertical-slice acceptance test

1. Authorized HR creates employee, active project, active site with coordinates/radius/timezone, schedule and dated assignment.
2. Admin links the verified Telegram account.
3. Worker opens Mini App and sees the resolved assignment.
4. Valid location check-in is accepted once, timestamped by API and visible to authorized admin.
5. A second request with the same idempotency key returns the same outcome; no duplicate records/events are created beyond intentional attempt telemetry.
6. Valid check-out closes the record, derives duration and appears in daily/weekly source queries.
7. Audit/event history identifies system and actor actions.

## Required negative tests

Invalid Telegram data; inactive employee/project/site; absent/wrong/ambiguous assignment; denied/unavailable/low-accuracy location; outside geofence; duplicate check-in/out; checkout before check-in; wrong role/site/project/organization; timezone boundary; no network client state; report calculation accuracy.

## Test layers

- Unit: distance, accuracy policy, schedule, status transitions, authorization predicates.
- Integration: Prisma constraints, API validation, transactions/idempotency, Telegram verifier.
- End-to-end: real API/database flow plus Mini App/admin happy path and key error states.
- Security: cross-tenant and cross-scope denial matrix.
