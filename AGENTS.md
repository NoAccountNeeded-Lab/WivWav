# WivWav — Agent Guide

WivWav is a wheelchair accessible vehicle (WAV) listing aggregator. It scrapes listings from multiple sources, normalizes data, and presents an analytics-first filter dashboard — mobile-first, API-first.

**AI-agnostic. Any capable agent can work here.**

---

## Architecture

See `.claude/core.md` for the monorepo structure, infrastructure overview, and key principles.

Dev environment setup and service URLs: [docs/ops/quick-start.md](docs/ops/quick-start.md).

---

## How agents work

1. Pick an open issue: `gh issue list --state open`
2. Add `status:in-progress`, post a brief check-in comment
3. Branch off main: `git fetch origin main && git checkout -b <prefix>/issue-{N}-{slug} origin/main`
4. Do the work — commit small and often; use `pnpm check:affected` for fast iteration checks; run the full suite before finishing
5. **Update [docs/api-routes.md](docs/api-routes.md)** if you added, removed, or renamed API routes
6. Validate, commit, push, and open a draft PR — see **SDLC CLI** below. Claude Code: `/wivwav-finish-issue`.
7. Review the draft PR and merge with `gh pr merge {N} --auto` — `main` is a merge-queue-protected branch; `--auto` enqueues the PR. See [docs/design/merge-queue.md](docs/design/merge-queue.md).

Never work directly on `main`. Never commit on failing tests.
Never leave an issue without a commit and draft PR — finish explicitly, not at session end.
Never commit `.env` files, secrets, generated cache files, or unrelated formatting churn.

### Definition of Done

An issue is not done until the implementation evidence is easy for another human or agent to audit:

- Every acceptance criterion from the issue is mapped to a proof line in the PR, using a command result, test, screenshot, log line, or explicit "not applicable" note.
- Required validation has run: typecheck, lint, relevant tests, and any manual checks named by the issue or touched area.
- User-facing changes include accessibility evidence for keyboard use, screen reader semantics, contrast, mobile layout, and visual-only alternatives where relevant.
- Deployment-impacting changes include release notes, rollback notes, and post-release smoke checks.
- Known gaps, skipped tests, or follow-up work are called out in the PR rather than hidden in the conversation.

Keep evidence concise. Link to logs, screenshots, or issue comments when details are long instead of pasting large output into the PR.

### Human handoffs

Agents must guide the human at SDLC decision points. If work is complete, blocked, ambiguous, ready for validation, ready for review, or waiting on product/technical judgment, end with 2–4 concrete next-step options, with one marked **Recommended** when there is a clear safest next step.

Keep the wording natural: state the current state, offer practical choices, recommend the safest next move, and name the command when one exists.

### Session start course correction

When a human starts an implementation request without an issue, branch, or stated intention to discuss only, agents should briefly course-correct before editing code:

- For implementation work, recommend the issue workflow: pick or confirm an issue, label it `status:in-progress`, branch from `main`, then start.
- For discussion, debugging, review, or planning, do not force the issue workflow; suggest opening an issue only when the discussion turns into implementation work.
- If the current branch is `main` and code changes are requested, stop and offer to create or select an issue and branch first.

If the PR touches `apps/web`, read `docs/BRAND.md` before writing any UI code.

### Agent token budget

Keep always-loaded agent context short and stable. Provider-specific guidance:

- **Claude / Claude Code:** use `CLAUDE.md` and `.claude/core.md` for startup context; use role files, skills, and subagents for task-specific detail. Keep returned subagent summaries concise.
- **Codex / OpenAI:** `AGENTS.md` is canonical. Use `pnpm wivwav start|review|finish|run-sprint` for the issue workflow. Preserve stable prompt prefixes and append per-issue context after reusable instructions so OpenAI prompt caching can hit.
- **Gemini:** use `GEMINI.md` for concise project context. Read `AGENTS.md` only when the task needs full workflow or architecture reference.
- **GitHub Copilot / Cursor:** use their repo instruction/rule files for concise defaults; read domain docs only when the touched files require them.
- **Ollama/local models:** optimize by reducing prompt size and using deterministic commands (`rg`, tests, typecheck, lint) instead of asking the model to rediscover repo state.

For every implementation task, search first, plan the likely files, then read the smallest useful file ranges.

The cross-agent optimization plan is tracked in `docs/design/agent-token-optimization.md`.

### Worker flow (sprint)

When a worker agent is spawned by `/wivwav-run-sprint`, it follows this sequence:

```
1. Branch from latest main
        git fetch origin main && git checkout -b {branch} origin/main

2. Fetch issue details
        gh issue view N --json number,title,body,labels

3. Plan  — before touching any file, write a brief plan:
        which files to create or modify, what types are needed, risks to watch for

4. Implement + tests  — write code and tests in a single pass

5. Review  — one Reviewer agent (foreground, blocking) reads role files matched to
             the changed file types: always reviewer + qa; add accessibility if
             apps/web/ changed; performance if api/scraper/db/queue changed;
             docs-accuracy if routes or .md files changed

6. Fix  — apply all findings (CRITICAL, WARNING, SUGGESTION)

7. /wivwav-finish-issue N  — fetch + rebase origin/main → typecheck + lint + build + test → commit → push → draft PR → status:needs-review
```

Spawned workers should receive the issue number and execution metadata, not the full issue body.

The `/wivwav-finish-issue` skill is in `.claude/skills/`. Review role prompts live in `.claude/roles/`.

---

### SDLC CLI

`packages/sdlc-cli` provides a first-class CLI that encodes the start/review/finish workflow. It is the canonical path for **all** agents — Claude Code uses the matching `/wivwav-*` skills; every other agent uses the CLI directly.

```bash
pnpm install  # once

# Start an issue — verifies state, AC, labels, branches, posts check-in comment
pnpm wivwav start <issue-number>

# Review changed files — runs affected checks and produces a review packet
pnpm wivwav review [issue-number]

# Finish — full validation, commit with trailers, push, open draft PR
pnpm wivwav finish <issue-number>

# Run sprint — select/claim issues, create worker worktrees, print worker prompts
pnpm wivwav run-sprint [issue-number]   # single issue
pnpm wivwav run-sprint --limit 2        # cap sequential run to 2 issues
pnpm wivwav run-sprint --parallel 3     # 3 concurrent workers

# All commands support --dry-run to preview actions without executing them
pnpm wivwav start 304 --dry-run
pnpm wivwav run-sprint --limit 2 --dry-run
```

`run-sprint` prepares work for agents; it does not implement issues by itself. It selects `status:ready` issues, verifies AC, labels them `status:in-progress`, creates isolated worktrees, and prints the worker prompt each agent should run in its worktree.

The CLI fails closed on: missing GitHub auth, issue not open or already in-progress, missing acceptance criteria, branch on `main`/`master`, rebase conflicts, validation failures, and unstaged files during finish.

#### Agent options for finish (attribution trailers)

```bash
pnpm wivwav finish 304 \
  --agent-role worker \
  --agent-index 1 \
  --sprint-run "run-sprint/2026-06-15T05:18" \
  --co-author "Codex GPT-4o <noreply@openai.com>"
```

Set `WIVWAV_CO_AUTHOR` or pass `--co-author` to override the default `Co-Authored-By` trailer.

#### Manual fallback (if CLI is unavailable)

**Start:**
```bash
gh issue view N --json number,title,body,labels
# Verify: open, not in-progress, has AC (checklist / "Acceptance Criteria" / "Done when")
gh issue edit N --add-label status:in-progress --remove-label status:ready
git fetch origin main && git checkout -b {prefix}/issue-N-{slug} origin/main
gh issue comment N --body "Starting work on issue #N. Branch: {branch-name}"
```

Prefix rules — `feat/`, `fix/`, `docs/`, `chore/` — follow **Commit format and branch naming**.

**Review:**
```bash
git diff origin/main --name-only
pnpm check:affected          # fast iteration
pnpm typecheck && pnpm lint && pnpm build && pnpm test  # full suite (required before finish)
```

Check for: type safety, security, logic bugs, AC coverage, WCAG 2.1 AA (web), routes table (api), arrow-fn pitfall (scraper). Label [CRITICAL] / [WARNING] / [SUGGESTION]. Fix all non-suggestion findings before finishing.

**Finish:**
```bash
git fetch origin main
git rebase origin/main   # required — fail and fix conflicts before continuing
pnpm typecheck && pnpm lint && pnpm build && pnpm test
git status --short
git add {relevant files only}
git commit -m "type(scope): description (fixes #N)" \
  --trailer "Agent-Role: worker" \
  --trailer "Co-Authored-By: Codex GPT-4o <noreply@openai.com>"
git push -u origin {branch}
gh pr create --draft --title "type(scope): description" --body "$(cat <<'EOF'
## Summary
{what changed and why}

## Acceptance Evidence
{one line per AC item — command output, test name, log line, or explicit gap note}

## Risk level
- [x] Low / [ ] Medium / [ ] High

## QA Notes
{what a human reviewer should manually verify before approving}
EOF
)"
gh issue edit N --add-label status:needs-review --remove-label status:in-progress
```

Tell the user: "Draft PR is open and the issue is labeled `status:needs-review`. Review the diff on GitHub and mark it ready when satisfied, then merge with `gh pr merge {N} --auto`."

---

## Commit format and branch naming

See `.claude/core.md` for commit format, branch prefixes, and attribution trailers.

---

## API routes

The full route table lives in [docs/api-routes.md](docs/api-routes.md). Keep it current when you add, remove, or rename a route.

Response envelope: most routes use `{ data: T }` for success and `{ error: { code, message } }` for errors. Exceptions: `GET /v1/listings` returns `{ data, facets, pagination }`; `GET /v1/sources` returns `{ sources: [] }`.

---

## Domain reference

| Area | Reference |
| ---- | --------- |
| Dev environment setup, make commands, service URLs | [docs/ops/quick-start.md](docs/ops/quick-start.md) |
| Ops workflows (geocode, scrape, queue, schedules) | [docs/ops/workflows.md](docs/ops/workflows.md) |
| Database schema conventions and migration procedure | [docs/data/schema-conventions.md](docs/data/schema-conventions.md) |
| API route table | [docs/api-routes.md](docs/api-routes.md) |
| Observability architecture (Loki, Grafana, Prometheus, Sentry) | [docs/design/observability-architecture.md](docs/design/observability-architecture.md) |
| CI/CD and merge queue | [docs/design/merge-queue.md](docs/design/merge-queue.md) |
| Remote cache (Turbo) | [docs/design/turbo-remote-cache.md](docs/design/turbo-remote-cache.md) |
| Agent token optimization plan | [docs/design/agent-token-optimization.md](docs/design/agent-token-optimization.md) |
| Scraper architecture and adding new sources | [apps/scraper/README.md](apps/scraper/README.md) |
| Testing conventions | `.claude/roles/tester.md` |

Read `docs/design/observability-architecture.md` before touching `packages/logger`, adding telemetry to app packages, or working on issues #255–#260, #263, #272, #273.

**Pitfall inside `page.evaluate` (scraper):** tsx's esbuild wraps named arrow-function-to-const assignments with `__name()`, which is not defined in the Playwright browser sandbox. Use `function` declarations instead of `const fn = () => {}` inside `page.evaluate`.
