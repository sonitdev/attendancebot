# Project Map

```text
attendace_bot/
├── apps/
│   ├── admin/                         Next.js management portal (Phase 3 active target)
│   ├── telegram-mini-app/             Next.js worker UI for Telegram Mini App (Phase 2 completed)
│   │   ├── src/app/page.tsx           Worker home, single-tap GPS check-in/out
│   │   ├── src/components/            Analytics tab, status feedback
│   │   └── src/lib/api.ts             Worker API client
│   └── api/
│       ├── src/main.ts                Nest bootstrap; global /api/v1 prefix
│       ├── src/app.module.ts          root module
│       ├── src/auth/                  SessionService (HMAC-SHA256), AuthGuard, RbacGuard
│       ├── src/telegram/              init-data verifier & session exchange
│       ├── src/attendance/            GPS check-in/out, geofencing, schedule evaluation
│       ├── src/admin/                 Workforce setup & management endpoints
│       ├── src/analytics/             Cross-project performance metrics
│       └── test/                      10 test suites (64 passing tests)
├── packages/contracts/src/index.ts    shared Zod input schemas/statuses
├── prisma/schema.prisma               PostgreSQL model (Supabase)
├── handoff/                           continuation & verification documentation
├── AGENTS.md                          engineering rules
├── PRODUCT_REQUIREMENTS.md            product scope
├── ARCHITECTURE.md                    service boundaries
├── DATABASE_SCHEMA.md                 schema intent
├── API_CONTRACT.md                    planned API
├── SECURITY_MODEL.md                  security rules
├── PAGE_PLAN.md                       phase order
├── TEST_PLAN.md                       acceptance/negative tests
├── .env.example                       placeholders only
└── docker-compose.yml                 local Redis
```

## Commands

```bash
cd ~/attendace_bot
pnpm typecheck
pnpm --filter @workforce/api test
pnpm --filter @workforce/api build
DATABASE_URL='postgresql://user:pass@localhost:5432/workforce' DIRECT_URL='postgresql://user:pass@localhost:5432/workforce' pnpm exec prisma validate --schema prisma/schema.prisma
```
