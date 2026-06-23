# WivWav — Agent Guide

WivWav is a wheelchair accessible vehicle (WAV) listing aggregator. It scrapes listings from multiple sources, normalizes data, and presents an analytics-first filter dashboard — mobile-first, API-first.

**AI-agnostic. Any capable agent can work here.**

---

## Architecture

See `.claude/core.md` for the monorepo structure, infrastructure overview, and key principles.

---

## Quick start

**Prerequisites:** Docker, Node 24, pnpm 11

```bash
# One-time setup
pnpm install
pnpm db:generate
cp apps/api/.env.example apps/api/.env
cp apps/scraper/.env.example apps/scraper/.env
cp apps/web/.env.example apps/web/.env.local
cp packages/db/.env.example packages/db/.env

# Each session
make up        # start full stack: Postgres, Valkey, Meilisearch, Ollama, and observability in Docker
make dev       # apply pending migrations, then start api, web, scraper with hot reload
```

| Service     | URL                   |
| ----------- | --------------------- |
| Web app     | http://localhost:3000 |
| API         | http://localhost:3001 |
| Ops app     | http://localhost:3002 |
| Meilisearch | http://localhost:7700 |

**Observability stack** (included in `make up`; or start alongside a running API with `docker compose --profile obs up`):

| Service       | URL                        | Notes                                           |
| ------------- | -------------------------- | ----------------------------------------------- |
| Grafana       | http://localhost:3003      | Anonymous admin — no login. Two dashboards:     |
|               |                            |   • WivWav Logs (Loki) — structured log explorer |
|               |                            |   • WivWav System (Prometheus) — HTTP traffic, queue depths, DB/cache/search health |
| Prometheus    | http://localhost:9090      | Scrapes `GET /metrics` every 15 s; 15-day retention |
| Loki          | http://localhost:3100      | Log aggregation (internal; Alloy writes here)   |
| API metrics   | http://localhost:3001/metrics | Prometheus text format — prom-client           |

Metrics exposed at `/metrics`: Node.js process defaults (heap, GC, event loop lag), HTTP request counts/latency/error-rate by route and status class, BullMQ queue depths (waiting/active/completed/failed/delayed) per queue, DB size and listing count, Valkey and Meilisearch availability gauges, Loki availability gauge (`wivwav_loki_up`), last successful source scrape timestamp (`wivwav_scraper_last_successful_run_timestamp_seconds`), and NHTSA refresh recency by queue (`wivwav_nhtsa_queue_last_completed_timestamp_seconds`).

**Known limitations:** The `/metrics` endpoint is unauthenticated and served on the same port as the public API (3001) — local development only. Only the API process is scraped; scraper and web services emit observability via logs/Loki instead. Queue depth is a point-in-time snapshot refreshed every 15 s by Prometheus. Job duration is not tracked.

```bash
make down      # stop infra containers
make test      # run unit tests (all packages)
make typecheck # type check all packages
make lint      # lint all packages

# Affected-only checks — fast iteration during development
make check-affected     # typecheck + lint + test for changed packages only
make typecheck-affected # typecheck changed packages only
make lint-affected      # lint changed packages only
make test-affected      # test changed packages only

# pnpm equivalents
pnpm check:affected
pnpm typecheck:affected
pnpm lint:affected
pnpm test:affected
```

All `*:affected` commands use `turbo --filter="...[origin/main]"` — they run only the packages whose source files have changed relative to `origin/main`. Use these for iteration speed. Run the full suite (`pnpm typecheck && pnpm lint && pnpm build && pnpm test`) before opening or finishing a PR.

Turbo uses a **shared remote cache** (Vercel Remote Cache) across CI and the self-hosted sprint runner. When `TURBO_TOKEN` and `TURBO_TEAM` are set, repeated runs with unchanged inputs skip re-execution and restore artifacts from the cache. Cache keys are pure content hashes of source files — no secrets are ever included. See `docs/design/turbo-remote-cache.md` for setup instructions, cache key details, invalidation, and troubleshooting.

```bash
# SDLC delivery metrics report
make sdlc-report                  # 30-day window (default)
make sdlc-report LOOKBACK_DAYS=90 # 90-day window
pnpm sdlc:report                  # pnpm equivalent
```

Requires `gh` CLI authenticated. Also available as a GitHub Actions workflow (`sdlc-metrics.yml`) triggered manually or every Monday at 08:00 UTC — results appear in the workflow run summary.

---

## SDLC delivery metrics

The project tracks five leading indicators of delivery health. All are collected from the GitHub API — no external tool required.

| Metric | What it measures | Threshold | Action when exceeded |
| --- | --- | --- | --- |
| **CI duration** | Avg wall-clock time for a passing CI run on `main` | ≥ 20 min | Investigate build/test optimisation (caching, parallelism, dropped steps) |
| **CI failure rate** | `failed / total` completed runs on `main` | ≥ 20% | Investigate flaky tests, environment issues, or missing pre-commit gates |
| **PR lead time** | Avg time from PR opened to merged | ≥ 2 days | Identify review bottlenecks; consider async review SLAs |
| **Re-review cycles** | Avg number of extra review-request events per merged PR | ≥ 2/PR | Tighten pre-review quality gates (linting, typecheck, code-review skill) |
| **Time-to-merge** | Avg time from last approval to merge | ≥ 24 h | Reduce merge friction (squash-merge policy, required-check wait times) |

### Interpreting the report

- **Healthy baseline**: CI < 10 min, failure rate < 5%, lead time < 1 day, re-review cycles < 1, TTM < 2 h.
- **Watch range**: any metric approaching its threshold needs a weekly eye but not immediate action.
- **Act immediately**: any metric at or above threshold — open an issue, set `status:ready`, and schedule it in the next sprint.
- Context matters: a spike in lead time around a major refactor is expected. Look at the trend across multiple periods, not a single week.

### Generating a baseline

```bash
# 30-day window (recommended starting point)
make sdlc-report

# 90-day window for a longer trend
make sdlc-report LOOKBACK_DAYS=90
```

The output is human-readable text. Copy it into the PR evidence section when relevant.

---

## How agents work

1. Pick an open issue: `gh issue list --state open`
2. Add `status:in-progress`, post a brief check-in comment
3. Branch off main: `git fetch origin main && git checkout -b <prefix>/issue-{N}-{slug} origin/main`
4. Do the work — commit small and often; use `pnpm check:affected` for fast iteration checks; run the full suite before finishing
5. **Update AGENTS.md** if you added, removed, or renamed API routes (keep the routes table current)
6. Validate, commit, push, and open a draft PR — see **SDLC CLI** below for the shell steps. Claude Code: `/wivwav-finish-issue`.
7. Review the draft PR on GitHub (the sprint worker's inline Reviewer agent has already checked the implementation) and merge with **rebase** (`gh pr merge --auto --rebase --delete-branch`) — `main` is a merge-queue-protected branch, so `--auto` is required to enqueue rather than merge immediately; see [docs/design/merge-queue.md](docs/design/merge-queue.md). Claude Code: `/wivwav-merge-pr {N}`.

Never work directly on `main`. Never commit on failing tests.
Never leave an issue without a commit and draft PR — finish explicitly, not at session end.

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

Keep the wording natural: state the current state, offer practical choices, recommend the safest next move, and name the command when one exists. Humans should not need to remember project slash commands or workflow order.

### Session start course correction

When a human starts an implementation request without an issue, branch, or stated intention to discuss only, agents should briefly course-correct before editing code:

- For implementation work, recommend the issue workflow: pick or confirm an issue, label it `status:in-progress`, branch from `main`, then start.
- For discussion, debugging, review, or planning, do not force the issue workflow; suggest opening an issue only when the discussion turns into implementation work.
- If the current branch is `main` and code changes are requested, stop and offer to create or select an issue and branch first.

If the PR touches `apps/web`, read `docs/BRAND.md` before writing any UI code.

### Agent token budget

Keep always-loaded agent context short and stable. `AGENTS.md` is the canonical source of truth, but agents should not repeatedly read the whole file when `.claude/core.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, or a scoped rule already has the needed detail.

Provider-specific guidance:

- **Claude / Claude Code:** use `CLAUDE.md` and `.claude/core.md` for startup context; use role files, skills, and subagents for task-specific detail. Keep returned subagent summaries concise.
- **Codex / OpenAI:** `AGENTS.md` is canonical. Use `pnpm wivwav start|review|finish|run-sprint` (see **SDLC CLI** below) for the issue workflow — these encode the deterministic gates and fail closed on missing auth or bad state. Preserve stable prompt prefixes and append per-issue context after reusable instructions so OpenAI prompt caching can hit.
- **Gemini:** use `GEMINI.md` for concise project context. Read `AGENTS.md` only when the task needs full workflow or architecture reference.
- **GitHub Copilot / Cursor:** use their repo instruction/rule files for concise defaults; read domain docs only when the touched files require them.
- **Ollama/local models:** optimize by reducing prompt size and using deterministic commands (`rg`, tests, typecheck, lint) instead of asking the model to rediscover repo state.

For every implementation task, search first, plan the likely files, then read the smallest useful file ranges. Do not open generated output, build artifacts, or broad directory trees unless needed to diagnose the issue.

The cross-agent optimization plan is tracked in `docs/design/agent-token-optimization.md`.

The observability architecture (log pipeline, collector, Loki, Grafana, Sentry, correlation strategy) is documented in `docs/design/observability-architecture.md`. Read it before touching `packages/logger`, adding telemetry to app packages, or working on any of issues #255–#260, #263, #272, #273.

### Worker flow (sprint)

When a worker agent is spawned by `/wivwav-run-sprint`, it follows this sequence:

```
1. Branch from latest main
        git fetch origin main && git checkout -b {branch} origin/main

2. Fetch issue details
        gh issue view N --json number,title,body,labels

3. Plan  — before touching any file, write a brief plan:
        which files to create or modify, what types are needed, risks to watch for

4. Implement  — write the code following AGENTS.md conventions

5. Implement + tests  — write code and tests in a single pass

6. Review  — one Reviewer agent (foreground, blocking) reads role files matched to
             the changed file types: always reviewer + qa; add accessibility if
             apps/web/ changed; performance if api/scraper/db/queue changed;
             docs-accuracy if routes or .md files changed

7. Fix  — apply all findings (CRITICAL, WARNING, SUGGESTION)

8. /wivwav-finish-issue N  — fetch + rebase origin/main → typecheck + lint + build + test → commit → push → draft PR → status:needs-review
```

Spawned workers should receive the issue number and execution metadata, not the full issue body. Fetching the issue body inside the worker keeps spawn prompts smaller across Claude, Codex, Gemini, Copilot/Cursor, and local-agent implementations.

The `/wivwav-finish-issue` skill is in `.claude/skills/`. Review role prompts live in `.claude/roles/`.

---

### SDLC CLI

`packages/sdlc-cli` provides a first-class CLI that encodes the start/review/finish workflow and the deterministic setup phase of sprint orchestration. It is the canonical path for **all** agents — Claude Code uses the matching `/wivwav-*` skills; every other agent uses the CLI directly.

```bash
# Install dependencies once; the CLI runs through the root pnpm script.
pnpm install

# Start an issue — verifies state, AC, labels, branches, posts check-in comment
pnpm wivwav start <issue-number>

# Review changed files — runs affected checks and produces a review packet
pnpm wivwav review [issue-number]

# Finish — full validation, commit with trailers, push, open draft PR
pnpm wivwav finish <issue-number>

# Run sprint — select/claim issues, create worker worktrees, print worker prompts
pnpm wivwav run-sprint [issue-number]
pnpm wivwav run-sprint --parallel 3

# All commands support --dry-run to preview actions without executing them
pnpm wivwav start 304 --dry-run
pnpm wivwav run-sprint --limit 2 --dry-run
```

`run-sprint` prepares work for agents; it does not implement issues by itself. It selects issues, checks AC, labels them `status:in-progress`, creates isolated worktrees, writes `/tmp/wivwav-{N}.md` recovery state, and prints the worker instructions an agent should run in each worktree.

#### Agent options for finish (pass attribution trailers)

```bash
pnpm wivwav finish 304 \
  --agent-role worker \
  --agent-index 1 \
  --sprint-run "run-sprint/2026-06-15T05:18" \
  --co-author "Codex GPT-4o <noreply@openai.com>"
```

The CLI fails closed on:
- Missing GitHub auth (`gh auth status` fails)
- Issue not open or already in-progress
- Missing acceptance criteria
- Branch on `main`/`master`
- Rebase against `origin/main` fails (conflicts must be resolved before finish)
- Validation suite failure (typecheck / lint / build / test)
- Unstaged or untracked files during finish

Set `WIVWAV_CO_AUTHOR` or pass `--co-author` to override the default `Co-Authored-By` trailer.

#### Manual fallback (if CLI is unavailable)

Agents that cannot run `pnpm wivwav` follow these direct shell equivalents:

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

Tell the user: "Draft PR is open and the issue is labeled `status:needs-review`. Review the diff on GitHub and mark it ready when satisfied, then run `/wivwav-merge-pr {N}` to merge."

---

### Worktree port isolation

Unit tests use `app.inject()` and do not bind ports — concurrent workers running tests never conflict. The conflict is only if a worker starts a **dev server**.

Ports are assigned by **agent index**: `base + (AGENT_INDEX * 10)`

| Agent | Who          | API ports  | Web ports  |
| ----- | ------------ | ---------- | ---------- |
| 0     | Human/local  | 3000–3009  | 4000–4009  |
| 1     | First worker | 3010–3019  | 4010–4019  |
| 2     | Second       | 3020–3029  | 4020–4029  |
| 3     | Third        | 3030–3039  | 4030–4039  |

The existing default ports (API=3003, web=3000) fall naturally in the human range.

```bash
# Get the port for this agent's dev server
bash scripts/worktree-port.sh api 1   # → 3010  (agent 1 API)
bash scripts/worktree-port.sh web 2   # → 4020  (agent 2 web)
bash scripts/worktree-port.sh api     # → 3000  (human, no index)
```

Workers receive their `AGENT_INDEX` from the orchestrator via the spawn prompt.
If you need more than 10 ports per agent, change `STEP=10` to `STEP=100` in `scripts/worktree-port.sh` — ranges expand to 100-199, 200-299, etc.

---

## Commit format and branch naming

See `.claude/core.md` for commit format, branch prefixes, and attribution trailers.

---

## API routes

| Method | Path                           | Description                          |
| ------ | ------------------------------ | ------------------------------------ |
| GET    | /health                        | Health check                         |
| GET    | /v1/listings                   | Search listings with filters         |
| GET    | /v1/listings/facets            | Facet aggregations (cached 60s)      |
| GET    | /v1/listings/:id               | Single listing detail                |
| GET    | /v1/listings/:id/price-history | Listing price history                |
| GET    | /v1/listings/:id/safety        | Safety summary (recalls with `status: open|remedied|unknown`, complaints, ratings, investigations, manufacturerCommunications, `safetyFreshnessDate`) for a listing |
| POST   | /v1/listings/:id/refresh-safety | Trigger on-demand NHTSA refresh (recalls, complaints, ratings, investigations, manufacturer communications) for the vehicle model linked to this listing. Rate-limited to once per model per hour. Returns `{ enqueued: bool, reason?, retryAfter?, jobIds? }`. |
| GET    | /v1/listings/:id/dealer        | Dealer profile + top 5 reviews for a listing. Returns `{ dealerProfile: null }` when no profile exists yet. |
| GET    | /v1/vin/:vin/safety            | Decode a VIN and return NHTSA safety summary when data is available |
| GET    | /v1/market/pricing                     | Price stats (percentiles, days listed, drop rate) for a make/model spec |
| GET    | /v1/market/popular                     | Top 10 makes, models, and conversion brands by active listing count |
| GET    | /v1/vehicles/:make/:model/stats            | Lifespan and reliability stats; returns `methodology` string and `sources: [{name, url}]` array (empty array when no source is recorded); optional `?year` falls back to aggregate row when no year-specific record exists |
| GET    | /v1/vehicles/:make/:model/:year/recalls        | Open recalls for a vehicle           |
| GET    | /v1/vehicles/:make/:model/:year/complaints     | Complaints for a vehicle             |
| GET    | /v1/vehicles/:make/:model/:year/research       | Latest cited model facts (EPA fuel economy, engine, drivetrain) with source URLs |
| GET    | /v1/vehicles/:make/:model/:year/investigations | NHTSA investigations for a vehicle model; each record has `sourceUrl` |
| GET    | /v1/vehicles/:make/:model/:year/communications | NHTSA TSBs (manufacturer communications) for a vehicle model; each record has `sourceUrl` |
| GET    | /v1/vehicles/:make/:model/:year/msrp           | Original MSRP from fueleconomy.gov; returns `originalMsrpCents`, `destinationFeeCents`, `currency`, and `source: {name, url, fetchedAt}` |
| GET    | /v1/conversion-brands          | List conversion brands with product counts and NMEDA certification status |
| GET    | /v1/conversion-brands/:slug    | Brand detail with full product catalog (conversionType, rampType, floorLoweringInches, msrpCents) |
| GET    | /v1/sources                    | List configured scraper sources      |
| GET    | /admin/queues                  | All queue names with stats           |
| GET    | /admin/queues/:name            | Single queue stats + recent jobs     |
| POST   | /admin/queues/:name/jobs       | Enqueue a job                        |
| POST   | /admin/queues/:name/pause      | Pause a queue                        |
| POST   | /admin/queues/:name/resume     | Resume a queue                       |
| GET    | /admin/runs                    | Recent scraper runs (last 100) + sourceName |
| GET    | /admin/sources                 | Sources with status and listing count|
| POST   | /admin/sources/:id/run         | Enqueue an immediate source-scrape job |
| POST   | /admin/sync                    | Re-index all listings into Meilisearch |
| GET    | /admin/listing-refresh/status  | Aggregate source, queue, listing, and map-readiness state for the guided refresh workflow |
| GET    | /admin/repeatables             | Canonical repeatable jobs merged with live BullMQ state |
| DELETE | /admin/repeatables/:queue      | Disable a repeatable job (remove from BullMQ by key) |
| POST   | /admin/repeatables/:queue      | Enable a repeatable job (add to BullMQ) |
| PUT    | /admin/repeatables/:queue      | Update a repeatable job's pattern (remove old key, add with new pattern) |
| GET    | /admin/ai/status               | Scraper AI provider health (Ollama by default) + installed models + sources needing remap |
| GET    | /admin/config                  | List all current config values (latest row per key). Secrets return hint only. |
| GET    | /admin/config/:key             | Get current value for one key (404 if tombstoned) |
| PUT    | /admin/config/:key             | Insert a new config row (append-only). Secrets: encrypts + returns hint. |
| GET    | /admin/config/:key/history     | All historical rows for a key (newest first) |
| GET    | /admin/config/:key/decrypt     | Decrypted plaintext for a secret key (server-to-server only — requires `Authorization: Bearer {INTERNAL_API_SECRET}` in production) |
| DELETE | /admin/config/:key             | Soft-delete: inserts a tombstone row (value: null) |
| GET    | /admin/logs                    | Recent log entries from Loki (query params: `service`, `search`, `limit` [default 200, max 500], `start` [ISO or ns epoch, default: 1 hour ago], `end` [ISO or ns epoch, default: now]); response: `{ data: { entries: LogEntry[], services: string[] } }`. Requires `LOKI_URL` env var (default `http://localhost:3100`; Docker Compose sets `http://loki:3100`). |
| GET    | /admin/logs/services           | Distinct service label values from Loki; response: `{ data: string[] }` |
| POST   | /admin/client-events           | Ingest a browser error event (js-error, unhandled-rejection, fetch-error, react-error) and log it via pino with `service: "web-client"` so it appears in the Loki pipeline. Returns 204. Unauthenticated. |
| GET    | /admin/board                   | Queue job inspector UI               |
| GET    | /metrics                       | Prometheus text-format scrape endpoint (prom-client). Exposes Node.js process metrics, HTTP request counts/latency by route, BullMQ queue depths per queue and status, DB size/listing count, Valkey and Meilisearch up gauges, Loki up gauge, last successful source scrape timestamp, and NHTSA refresh recency by queue. Scraped by Prometheus every 15 s when the `obs` profile is active. |

Most responses use `{ data: T }` for success and `{ error: { code, message } }` for errors. Exceptions: `GET /v1/listings` returns `{ data, facets, pagination }`; `GET /v1/sources` returns `{ sources: [] }`.

---

## Ops workflows

Everything below is done through the ops UI at **http://localhost:3002/ops** — never via CLI during normal operations. Direct the user to the relevant page; don't paste curl commands.

### Get listings on the map

Listings need GPS coordinates to appear as pins on the search map. New scraped listings arrive without coordinates. The pipeline is:

1. **Scrape** — `/ops/sources` → "Run Now" on a source, or wait for its cron schedule.
2. **Geocode** — `/ops/queues` → find the `geocode` row → click **Trigger**. This resolves city + state → lat/lng for every ungeocoded listing. Rate-limited to 1 req/sec (Nominatim policy), but it deduplicates by unique city/state, so 4 000 listings in 200 distinct cities only fires 200 requests (~3–4 min), not 4 000.
3. **Sync Meilisearch** — same `/ops/queues` page → click **Sync Meilisearch** (top-right button). This re-indexes all listings from Postgres into Meilisearch so the new coordinates become searchable and visible on the map.

Geocode runs nightly at 2 AM; sync does **not** run automatically — you must trigger it after geocode completes if you want map pins without waiting.

### Scrape a source immediately

`/ops/sources` → "Run Now" next to the source. Progress appears on `/ops/runs` and in the queue activity panel on `/ops/queues`.

### Inspect a job or retry a failure

`/ops/queues` → click a queue name to expand live job activity. For full payloads and stack traces, use the **Bull Board** link (top-right of the Queues page).

### Trigger any background job immediately

`/ops/queues` → find the queue → **Trigger** (where available). Queues that can be triggered: `geocode`, `detail-crawl`, `detail-extract`, `deduplicate`.

### Enable, disable, or edit a schedule

`/ops/schedules` — lists all repeatable jobs with their current cron pattern, next run time, and enable/disable status. Toggle or edit any schedule without restarting the scraper. Changes take effect immediately in BullMQ/Valkey.

Schedules are stored in **Valkey** by BullMQ, not in node-cron or any config file. The scraper registers defaults on first boot only — subsequent restarts do not override user changes. Disabling a schedule removes it from BullMQ; it stays disabled across scraper restarts.

### Background job schedule (defaults)

| Queue                | Default schedule  | Notes |
| -------------------- | ----------------- | ----- |
| source-scrape        | Per-source (6–8h) | Configured on each Source row |
| detail-crawl         | Hourly            | Playwright; rate-limited to 1 page/2 s |
| detail-extract       | Every 5 min       | No network; reads stored HTML |
| geocode              | Nightly 2 AM      | Deduplicated by city/state |
| deduplicate          | Nightly 3 AM      | VIN-matched |
| vin-enrich           | Hourly :30        | NHTSA VIN decode → upsert VehicleModel |
| nhtsa-recalls        | Nightly 4 AM      | Recalls for all VehicleModels in inventory |
| nhtsa-complaints     | Weekly Sun 5 AM   | Complaints for all VehicleModels |
| nhtsa-safety-ratings | Weekly Sun 6 AM   | Safety ratings for all VehicleModels |
| vehicle-stats-refresh | Weekly Sun 1 AM  | Re-seeds lifespan/reliability stats from static JSON |

---

## Data model

See `packages/types/src/listing.ts` for the complete `Listing` interface.

The `GET /v1/listings/:id` response groups listing fields into three nested objects:
- `wav` — `conversionType`, `conversionManufacturer`, `floorLoweringInches`, `rampType`, `hasLift`, `handControls`, `transferSeat`, `wheelchairCapacity`
- `location` — `zip`, `city`, `state`, `lat`, `lng`
- `dealer` — `name`, `phone`, `website`

### Naming conventions

- **Table names:** singular snake_case — `listing_price_history`, `vehicle_stats`
- **Column names:** camelCase in Prisma model fields; column names in the DB match the field name exactly (camelCase) unless an explicit `@map` decorator is added
- **Enums:** singular PascalCase — `SourceStatus`, `ConversionType`

> Many existing tables use plural names (`sources`, `listings`, `scraper_runs`, `raw_pages`, `vehicle_models`, `recalls`, `complaints`, `safety_ratings`, `conversion_brands`, `conversion_products`, `nmea_dealers`). Do not rename them. All new tables must use singular names.

### Schema changes

**Never use `make db-push` for schema changes that will be deployed.** Instead:

1. Edit `packages/db/prisma/schema.prisma`
2. Run `make db-migrate-create` — Prisma generates a `.sql` file in `prisma/migrations/`
3. Commit the migration file alongside the schema change
4. CI will reject PRs where the schema and migrations are out of sync
5. On deploy, the `migrate` Docker service applies pending migrations automatically before the API starts

---

## Scraper architecture

Each source has a `SourceAdapter` in `apps/scraper/src/sources/` implementing:

- `checkStructure()` — fetches a sample page, hashes the DOM, compares to stored hash
- `scrape()` — runs the full Playwright scrape, returns normalized listings

If `checkStructure()` detects a change, the engine marks the source `needs_remapping` and calls the configured AI provider to derive new CSS selectors (default: Ollama; set `ai.scraper.structure.provider` in the config DB to switch). Sources run on independent cron schedules.

**Pitfall inside `page.evaluate`:** tsx's esbuild wraps named arrow-function-to-const assignments with `__name()`, which is not defined in the Playwright browser sandbox. Use `function` declarations instead of `const fn = () => {}` inside `page.evaluate`.

### Adding a new source

1. Create `apps/scraper/src/sources/<name>.ts` implementing `SourceAdapter`
2. Register it in `apps/scraper/src/index.ts`
3. Add a seed row to the `sources` table or upsert it on startup

---

## Testing

- **Unit:** Vitest (`make test`) — no network, no DB. Fast.
- **Integration:** Vitest (`make exec CMD="pnpm test:integration"`) — hits real services.

Test files live next to source: `foo.ts` → `foo.test.ts`. Integration tests use `*.integration.test.ts`.

---

## CI/CD

- **All pushes/PRs:** `ci.yml` runs three parallel jobs — `Docker builds`, `Lint & Typecheck`, `Test`
- **Main branch:** build + push Docker images to ghcr.io (`publish.yml`)
- **Merge queue:** `main` requires all three `ci.yml` jobs to pass before merging, enforced via a repository ruleset (not classic branch protection) with `merge_group` support in `ci.yml`. See [docs/design/merge-queue.md](docs/design/merge-queue.md) for the full ruleset configuration, the `--auto` merge path, and verification evidence.

---

## Environment variables

See `.env.example` in each app directory. Never commit `.env` files.

- CI: only `GITHUB_TOKEN` (auto-provided)

AI API keys and provider selection are managed through the config DB, not env vars. Set them via `/ops/ai` or the `/admin/config` API:

| Config key | Description |
| --- | --- |
| `secret.anthropic.default` | Anthropic API key (type: secret, encrypted at rest) |
| `ai.<job>.provider` | `anthropic` or `ollama` — which provider a job uses |
| `ai.<job>.model` | Model name for that provider |
| `ai.<job>.apiKeyId` | Points to the secret config key holding the API key |

Where `<job>` is one of: `intake`, `scraper.structure`, `scraper.remap`, `agents`.
