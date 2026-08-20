# WivWav agent rules

WivWav aggregates wheelchair-accessible vehicle listings; architecture is API-first, analytics-first, and mobile-first.

Architecture: `.claude/core.md`.
Setup and service URLs: `docs/ops/quick-start.md`.

## Workflow

Discussion, debugging, review, and planning do not require an issue; require an issue before implementation.
Before implementation: confirm or select an open issue; verify acceptance criteria; set `status:in-progress`; branch from latest `origin/main`; post a check-in comment.
If implementation is requested without an issue or branch, recommend the issue workflow before editing.
If the current branch is `main` or `master`, stop; offer to select or create an issue and branch.
Never implement directly on `main`.

Search first with `rg`; state likely files, types, and risks; read the smallest relevant ranges.
Keep changes and commits issue-scoped; do not mix unrelated work.
Code-changing workers must make coherent, functional commits. Do not collapse an issue into one large commit when behavior, tests, docs, or review fixes can stand separately. Avoid WIP commits and unrelated churn.
Fully qualify SQL column references in worker-authored queries, especially in joins, CTEs, and raw SQL. Do not rely on unqualified `id`, `status`, or similarly reused column names. Ambiguous SQL must fail review.
Never commit `.env` files, secrets, generated caches, or unrelated formatting churn.
Never commit with failing relevant checks.
Update `docs/api-routes.md` when adding, removing, or renaming API routes.
Do not add new WivWav-owned runtime URLs under `/admin/*`. Use `/internal/ops/*` for private operator APIs and `/ops/*` for the ops UI/BFF surface unless an existing issue explicitly authorizes a narrower exception.
Before UI edits under `apps/web`, read `docs/BRAND.md`.
Before adding a new `packages/*` or `apps/*` workspace, read `.claude/skills/wav-new-package/SKILL.md` and update every Dockerfile it identifies (`docker/api`, `docker/web`, `docker/ops`, `docker/worker`, `docker/migrate`, `docker/dev`); `pnpm-workspace.yaml` and `turbo.json` pick up new workspaces automatically, Dockerfiles do not.
Before editing `packages/db/prisma/schema.prisma`, read `.claude/skills/wav-prisma-migration/SKILL.md`; never use `db:push`/`make db-push` for a change that will be deployed, and verify with `prisma migrate diff --exit-code` locally before pushing — that is the exact check CI runs.
Before adding or modifying a scraper source, read `.claude/skills/wav-add-scraper-source/SKILL.md`; source code lives in `packages/scraper-sources/src/sources/`, not `apps/scraper` (relocated, no longer exists as a package).

Use the SDLC CLI:

```bash
pnpm wivwav start <issue-number>
pnpm wivwav review [issue-number]
pnpm wivwav finish <issue-number>
pnpm wivwav run-sprint [issue-number]
pnpm wivwav run-sprint --limit 2
pnpm wivwav run-sprint --parallel 3
```

All commands accept `--dry-run`.
Set `WIVWAV_CO_AUTHOR` or pass `--co-author` to override the default `Co-Authored-By`.
Treat missing GitHub auth, invalid issue state, missing acceptance criteria, protected branches, rebase conflicts, validation failures, and unrelated dirty files as blockers.

Iteration: `pnpm check:affected`.
Built-container Playwright suite (smoke, accessibility, Discover facets): `pnpm test:e2e`.
Before finish: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
Finish only from a feature branch rebased onto `origin/main`.
Finish must commit, push, open or update a draft PR, and set `status:needs-review`.
Merge approved PRs with `gh pr merge {N} --auto`; do not pass `--rebase` or `--delete-branch`.

## Manual fallback

Use only when the SDLC CLI is unavailable.

```bash
gh issue view N --json number,title,body,labels
gh issue edit N --add-label status:in-progress --remove-label status:ready
git fetch origin main
git checkout -b {prefix}/issue-N-{slug} origin/main
gh issue comment N --body "Starting work on issue #N. Branch: {branch-name}"
```

Issue must be open, not already in progress, and contain `Acceptance Criteria`, `Done when`, `## AC`, or a non-empty checklist.
Branch prefixes: `feat/`, `fix/`, `docs/`, `chore/`.

Review:

```bash
git diff origin/main --name-only
pnpm check:affected
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Review correctness, security, type safety, logic, acceptance coverage, WCAG 2.1 AA, API documentation, and scraper browser-sandbox safety.
Label findings `[CRITICAL]`, `[WARNING]`, or `[SUGGESTION]`.
Fix `[CRITICAL]` and `[WARNING]`; explicitly resolve or defer `[SUGGESTION]`.
Sprint workers must fix all findings.

Finish:

```bash
git fetch origin main
git rebase origin/main
git status --short
git add {relevant files only}
git commit -m "type(scope): description (fixes #N)" \
  --trailer "Agent-Role: {role}" \
  --trailer "Agent-Index: {index}" \
  --trailer "Sprint-Run: {sprint-run-id}" \
  --trailer "Co-Authored-By: {Model Name} <noreply@{provider}.com>"
git push -u origin {branch}
gh issue edit N --add-label status:needs-review --remove-label status:in-progress
```

Omit unavailable `Agent-Role`, `Agent-Index`, and `Sprint-Run`; retain `Co-Authored-By`.

Draft PR body:

```markdown
Fixes #N
🤖 **{role}[{index}]** · `{skill}` · {YYYY-MM-DD}

## Summary
{what changed and why}

## Acceptance Evidence
{one concise proof line per acceptance criterion}

## Tests
{commands and results}

## Risk level
- [x] Low / [ ] Medium / [ ] High

## QA Notes
{manual checks, accessibility evidence, gaps, and follow-ups}

## Deployment
{release notes, rollback, and smoke checks; or not applicable}
```

Use `Refs #N` for intentionally partial work.

## Definition of done

Map every acceptance criterion to a command result, test, screenshot, log, or explicit `not applicable`.
Run typecheck, lint, build, relevant tests, full tests, and issue-required manual checks.
For user-facing changes, record keyboard, screen-reader semantics, contrast, mobile layout, touch-target, and non-visual-alternative evidence as applicable.
For deployment changes, record release notes, rollback, and post-release smoke checks.
Record skipped checks, missing tests, known gaps, and follow-ups in the PR.
Link long evidence; do not paste large logs.

At SDLC handoffs, state status and give 2–4 concrete next steps; mark the safest clear option **Recommended** and include its command.

## Sprint workers

`pnpm wivwav run-sprint` owns issue selection, labels, branches, worktrees, and worker context.
Workers receive issue number and execution metadata; do not include the full issue body in spawn prompts.
Workers verify the prepared worktree and branch; read `.agents/worker-context.md` and `.agents/issue-context.md`; plan before source reads.
Workers must fully qualify SQL column references in joins, CTEs, and raw SQL; ambiguous names such as `id` and `status` are review failures.
Implement code and tests; commit after each coherent functional slice.
Preserve those commits through PR creation; do not squash unless explicitly instructed.
Run one foreground/blocking reviewer with `.claude/roles/reviewer.md` and `.claude/roles/qa.md`.
Add `.claude/roles/accessibility.md` for `apps/web`.
Add `.claude/roles/performance.md` for API, scraper, DB, queue, or search changes.
Add `.claude/roles/docs-accuracy.md` for route or Markdown changes.
Apply all findings and record review results.
Finish with `/wav-finish-issue N`.
On failure: comment, set `status:stuck`, and report the reason.

## API

Canonical routes: `docs/api-routes.md`.
Default success: `{ data: T }`.
Default error: `{ error: { code, message } }`.
Exceptions: `GET /v1/listings` returns `{ data, facets, pagination }`; `GET /v1/sources` returns `{ sources: [] }`.

## References

Setup and URLs: `docs/ops/quick-start.md`.
Ops workflows: `docs/ops/workflows.md`.
Schema and migrations: `docs/data/schema-conventions.md`.
Routes: `docs/api-routes.md`.
Observability: `docs/design/observability-architecture.md`.
Merge queue: `docs/design/merge-queue.md`.
Turbo cache: `docs/design/turbo-remote-cache.md`.
Agent optimization: `docs/design/agent-token-optimization.md`.
Testing: `.claude/roles/tester.md`.

Read `docs/design/observability-architecture.md` before changing `packages/logger`, adding telemetry, or working on issues #255–#260, #263, #272, or #273.
Inside `page.evaluate`, use `function` declarations; do not use named arrow-function-to-const assignments because Playwright lacks esbuild's injected `__name`.
