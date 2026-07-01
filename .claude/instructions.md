# Claude app rules

Read `.claude/core.md` and the active role first.

## Web

Before `apps/web` UI edits, read `docs/BRAND.md`.
Use Server Components by default; add `'use client'` only at interactivity boundaries.
Use URL search parameters and React hooks for state; no Redux or Zustand.
Use CSS Modules and semantic color tokens; no Tailwind.
Meet WCAG 2.1 AA: keyboard, screen reader, visible focus, mobile touch targets, and non-color status.
Web: `http://localhost:3000`.

## API

Use Fastify Route → Service → Repository.
Web clients call the API; never read the database directly.
API: `http://localhost:3001`; Swagger: `http://localhost:3001/documentation`.
For route additions, removals, or renames, update `docs/api-routes.md`.

## Scraper

Use Playwright and the current Ollama provider.
`SourceAdapter` requires `checkStructure()` and `scrape()`.
Apply AI remaps only at confidence `>= 0.7`.
Inside `page.evaluate`, use `function` declarations; do not use named arrow-function-to-const assignments.
For structure failures, inspect changed source HTML and current Ollama configuration.

## Commands

Start development: `make dev`.
Unit tests: `make test`.
Integration tests: `make test-integration`.
Types: `make typecheck`.
Schema synchronization: `pnpm db:push`; follow `docs/data/schema-conventions.md`.
No supported `pnpm db:reset` command exists.

Before finish: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
Never commit failing relevant checks.
Use `/wivwav-finish-issue`; do not rely on session end.

Review priority: correctness; security/data exposure; accessibility; API/data contract drift; missing tests.
