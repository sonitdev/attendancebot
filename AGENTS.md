# Engineering Rules

## Required reading order

Before editing code, read:

1. `MASTER_PLAN.md`
2. `PRODUCT_REQUIREMENTS.md`
3. `ARCHITECTURE.md`
4. `DATABASE_SCHEMA.md`
5. `API_CONTRACT.md`
6. `SECURITY_MODEL.md`
7. `DESIGN_SYSTEM.md`
8. `PAGE_PLAN.md`
9. `TEST_PLAN.md`

## Non-negotiable rules

1. NestJS is the authoritative business layer; Supabase does not replace it.
2. Only the server determines official attendance timestamps and final status.
3. Verify Telegram Mini App `initData` on the server for every worker session. Never trust browser-provided Telegram identity.
4. Calculate geofence distance and location reliability on the server. Client location is evidence, not authority.
5. Every organization-scoped query and mutation must enforce `organizationId`; cross-organization access is a security defect.
6. RBAC and project/site scope checks occur server-side, never only in UI routing.
7. Preserve attendance events, corrections, overrides and audit history. Never silently rewrite historical attendance.
8. Keep attendance facts separate from human performance assessments. Never automate promotion, firing or discipline recommendations.
9. Workers see only their own assignment and attendance records. Do not continuously track workers in V1.
10. Use idempotency plus database constraints for check-in and check-out. A retry must not create duplicate attendance.
11. Store timestamps in UTC; display them using the assigned site's configured IANA timezone.
12. No secrets, service-role keys, raw location coordinates or Telegram init-data may be logged unnecessarily or committed.
13. Use shared validated contracts between apps and API. Validate all external input at the API boundary.
14. Finish and test one module before beginning unrelated modules. The core vertical slice comes before broad dashboards.

## Change discipline

- Inspect existing implementation and migrations before adding a feature.
- Keep migrations forward-only and reviewable; do not use destructive schema changes without a migration/restore plan.
- Add focused tests for each authorization, attendance-state, time-zone and failure-path change.
- Report what was verified and what remains unverified. Do not label mocked UI as a completed attendance flow.
