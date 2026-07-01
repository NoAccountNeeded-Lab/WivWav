# Repository instructions

WivWav is a TypeScript monorepo for wheelchair-accessible vehicle search.
Follow `AGENTS.md` for workflow; use `.claude/core.md` for architecture and conventions.

Keep implementation issue-driven; link each PR to its issue.
Preserve API-first boundaries; web calls APIs and never reads the database directly.
Keep swappable dependencies behind interfaces.
Use mobile-first UI and WCAG 2.1 AA.
Runtime dependency licenses: MIT, Apache-2.0, BSD, or PostgreSQL License only; never GPL or AGPL.
Use strict TypeScript; no `any`.
NodeNext local imports use `.js`; Bundler source imports in `apps/web`, `apps/ops`, and `packages/charts` are extensionless.
Add focused tests for changed and risky behavior.
Never commit `.env` files, secrets, generated caches, or unrelated formatting.
Search with `rg`; read narrow ranges; consult relevant `docs/ops/`, `docs/data/`, or `docs/design/` files.
For `apps/web` UI changes, read `docs/BRAND.md`.

Review order: correctness/regressions; security/data exposure; accessibility; API/data contract drift; missing tests.
