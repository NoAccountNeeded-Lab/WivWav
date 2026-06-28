# WivWav Gemini Context

WivWav is a pnpm/Turborepo TypeScript monorepo for wheelchair accessible vehicle listings.

Use `AGENTS.md` as the canonical project guide. For domain-specific reference beyond AGENTS.md, consult: `docs/ops/quick-start.md` (dev setup), `docs/ops/workflows.md` (ops procedures), `docs/data/schema-conventions.md` (schema/migrations), `docs/api-routes.md` (route table), and `docs/design/` for observability, merge queue, and caching design. For quick orientation:

- Apps: `apps/api` Fastify REST API, `apps/web` Next.js App Router, `apps/scraper` Playwright scraper.
- Packages: `packages/types`, `packages/db`, `packages/config`, `packages/queue`, `packages/agents`.
- Use strict TypeScript, ESM `.js` local imports, mobile-first UI, and WCAG 2.1 AA for user-facing output.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before committing.
- Never work directly on `main`; use the issue branch workflow in `AGENTS.md`.

Keep context use deliberate. Search first with `rg`, read narrow file ranges, and avoid loading generated files, build output, or broad directory trees.
