# WivWav Gemini context

WivWav is a pnpm/Turborepo TypeScript monorepo for wheelchair-accessible vehicle listings.
Use `AGENTS.md` as canonical workflow; use `.claude/core.md` for architecture and conventions.
Search with `rg`; read narrow ranges; skip generated files, build output, and broad directory trees.

Strict TypeScript; no `any`.
NodeNext local imports use `.js`; Bundler source imports in `apps/web`, `apps/ops`, and `packages/charts` are extensionless.
Preserve API-first boundaries, mobile-first UI, and WCAG 2.1 AA.
Never work directly on `main`.
Iteration: `pnpm check:affected`.
Before finish: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
