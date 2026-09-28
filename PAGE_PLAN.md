# Page Plan

## Phase 0 — foundation

Repository tooling, database schema, contracts, authentication boundary, RBAC policy, design tokens, Telegram integration proof.

## Phase 1 — vertical slice

1. Admin: employee create/list/detail.
2. Admin: project, site/geofence, schedule and assignment setup.
3. Worker: Telegram session/link state and single-assignment home.
4. Worker: check-in and check-out state machine.
5. Admin: today's attendance list and detail event timeline.
6. API: all validation, persistence, audit and event behavior behind those experiences.

## Later phases

Attendance history/exceptions/corrections; performance records; reports; notifications; hardening. Do not build these ahead of a verified Phase 1.
