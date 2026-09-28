# Architecture

## Monorepo

Use pnpm workspaces:

```text
apps/admin                Next.js, management UX
apps/telegram-mini-app    Next.js, Telegram WebApp UX
apps/api                  NestJS REST API, BullMQ processors
packages/contracts        DTO schemas/types shared across apps/API
packages/config           shared tooling configuration
prisma                    PostgreSQL schema and migrations
```

## Service boundaries

The API owns authentication/authorization, Telegram validation, attendance state transitions, geofence calculation, reporting queries, audit logging and job scheduling. PostgreSQL (Supabase) is persistent storage. Redis/BullMQ handles scheduled reminders, missing-checkout review, potential absence evaluation, notification delivery and asynchronous report generation.

## Request path

`Mini App → HTTPS API → validate initData → resolve scoped worker/assignment → validate location and schedule → transactional attendance write + event + audit → response`

The admin portal receives read models through the API. Supabase Realtime may update operational dashboard data, but is never the authorization or business-rule source.

## Key decisions

- Prisma is the sole application ORM for database writes/reads.
- PostgreSQL UTC timestamps plus IANA site timezone for official display/calculation.
- Haversine distance in metres; reliability policy must combine distance and reported accuracy.
- Transactional outbox or post-commit BullMQ enqueueing is required before notifications are relied upon.
- All storage objects are private; API issues authorized signed URLs.
