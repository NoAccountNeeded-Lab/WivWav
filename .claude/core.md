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

## Git

Branch from latest `origin/main`; never work directly on `main`.
Branches: `feat/issue-N-slug`, `fix/issue-N-slug`, `docs/issue-N-slug`, or `chore/issue-N-slug`.
Commits: `type(scope): description (fixes #N)`.
Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
Use `refs #N` only for intentionally partial work.
PR body must contain `Fixes #N` or `Refs #N`; the commit keyword alone does not reliably close through the merge queue.

Issue states: `status:ready` → `status:in-progress` → `status:needs-review` → merged.
Failure: `status:in-progress` → `status:stuck`.
Acceptance criteria markers: `acceptance criteria`, `done when`, `## ac`, or a non-empty `- [ ]` checklist; matching is case-insensitive.

Every agent commit requires:

```text
Co-Authored-By: {Model Name} <noreply@{provider}.com>
```

Add when available:

```text
Agent-Role: {role}
Agent-Index: {index}
Sprint-Run: {sprint-run-id}
```

Agent comments and issue updates start with:

```text
🤖 **{role}[{index}]** · `{skill}` · {YYYY-MM-DD}
```

PR bodies start with `Fixes #N` or `Refs #N`; place the attribution header immediately after.

## Validation

Iteration: `pnpm check:affected`.
Finish: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
Never commit failing relevant checks.

Read `.claude/roles/{your-role}.md` after this file.
Read `AGENTS.md` only for workflow or domain detail not present here.
