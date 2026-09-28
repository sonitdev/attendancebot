# Workforce Site Attendance & Performance System

A multi-organization workforce attendance platform for physical project sites. Workers use a Telegram Mini App to check in and out; management uses a web portal to manage workforce, sites, exceptions, performance and reports.

## Current scope

The first delivery is one complete, production-shaped vertical slice:

`Employee → Project → Site → Assignment → Telegram identity → GPS Check-In → API validation → Attendance visible to admin → GPS Check-Out`

No mock confirmation is acceptable in that flow. The API owns timestamps, authorization, geofence evaluation, audit events and persistence.

## Workspace

```text
apps/admin                 Next.js management portal
apps/telegram-mini-app     Next.js worker experience
apps/api                   NestJS API and BullMQ workers
packages/contracts         Shared, validated API contracts
packages/config            Shared lint/type/configuration
prisma                     Prisma schema and migrations
docs                       Supporting implementation references
```

## Before coding

Read [AGENTS.md](AGENTS.md), then the required source-of-truth documents listed there. Start with [PAGE_PLAN.md](PAGE_PLAN.md) and the first vertical-slice acceptance test in [TEST_PLAN.md](TEST_PLAN.md).

## Local prerequisites

Node.js 22 LTS, pnpm 9+, Docker Desktop, a Supabase project, and a Telegram bot/Mini App configuration. Copy `.env.example` to `.env`; never commit actual credentials.

## Proposed local commands

```bash
pnpm install
docker compose up -d redis
pnpm dev
pnpm test
pnpm typecheck
```

Application packages are intentionally not scaffolded with framework-generated boilerplate yet. Create them only after the Phase 0 contracts, schema and security decisions receive approval.
