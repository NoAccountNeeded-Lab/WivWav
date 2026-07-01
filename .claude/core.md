# WivWav core

## Structure

```text
apps/api               Fastify REST API; Node 24
apps/web               Next.js 16 App Router
apps/ops               Next.js 16 operations UI
apps/scraper           Playwright scraper and Ollama remapping
packages/types         Shared TypeScript interfaces
packages/db            Prisma; PostgreSQL 17
packages/config        Shared TypeScript and ESLint configuration
packages/queue         BullMQ
packages/agents        Ollama and Anthropic completion pipeline
packages/charts        Shared chart components
packages/search        Meilisearch integration
packages/logger        Logging
packages/observability Telemetry
packages/sdlc-cli      Issue workflow CLI
```

Infrastructure: PostgreSQL 17; Meilisearch 1.45; Valkey 8.

## Rules

Small files; one responsibility.
Keep swappable dependencies behind interfaces; callers must not import concrete implementations.
Preserve API-first boundaries; web clients call APIs, not the database.
Use mobile-first UI; all user-facing output must meet WCAG 2.1 AA.
Runtime dependency licenses: MIT, Apache-2.0, BSD, or PostgreSQL License only; never GPL or AGPL.
TypeScript: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`; no `any`; no unjustified non-null assertions; use `import type` for type-only imports.
NodeNext local imports require `.js` in `apps/api`, `apps/scraper`, and all NodeNext packages.
Bundler source imports are extensionless in `apps/web`, `apps/ops`, and `packages/charts`; follow local test patterns.
API defaults: `{ data: T }` success; `{ error: { code, message } }` error; preserve documented route exceptions.

## Database

New table names: singular `snake_case`.
Do not rename existing plural tables.
For schema or migration changes, follow `docs/data/schema-conventions.md`.

Read `AGENTS.md` for canonical workflow.
Read `.claude/roles/{your-role}.md` for role-specific execution.
