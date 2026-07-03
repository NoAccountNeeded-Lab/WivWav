# Quick Start — Development Environment

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

## Service URLs

| Service     | URL                   |
| ----------- | --------------------- |
| Web app     | http://localhost:3000 |
| API         | http://localhost:3001 |
| Ops app     | http://localhost:3002 |
| Meilisearch | http://localhost:7700 |

## Observability stack

Included in `make up`; or start alongside a running API with `docker compose --profile obs up`.

| Service       | URL                        | Notes                                           |
| ------------- | -------------------------- | ----------------------------------------------- |
| Grafana       | http://localhost:3003      | Anonymous admin — WivWav Logs (Loki) + WivWav System (Prometheus) dashboards |
| Prometheus    | http://localhost:9090      | Scrapes `GET /metrics` every 15 s; 15-day retention |
| Loki          | http://localhost:3100      | Log aggregation (internal; Alloy writes here)   |
| API metrics   | http://localhost:3001/metrics | Prometheus text format — prom-client           |

The exposed `/metrics` series, scrape scope, and known limitations are documented in [docs/design/observability-architecture.md](../design/observability-architecture.md).
Before changing Grafana, Loki, Alloy, or Prometheus versions, follow the
[observability upgrade runbook](observability-upgrade.md) for configuration
validation, volume backups, migration smoke checks, and rollback.

## Common commands

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

Turbo uses a **shared remote cache** (Vercel Remote Cache) across CI and the sprint runner: with `TURBO_TOKEN`/`TURBO_TEAM` set, unchanged inputs skip re-execution. See [docs/design/turbo-remote-cache.md](../design/turbo-remote-cache.md) for setup, cache keys, invalidation, and troubleshooting.

## SDLC delivery metrics report

```bash
make sdlc-report                  # 30-day window (default)
make sdlc-report LOOKBACK_DAYS=90 # 90-day window
pnpm sdlc:report                  # pnpm equivalent
```

Requires `gh` CLI authenticated. Also available as a GitHub Actions workflow (`sdlc-metrics.yml`) triggered manually or every Monday at 08:00 UTC — results appear in the workflow run summary.

### Delivery health metrics

The project tracks five leading indicators:

| Metric | What it measures | Threshold | Action when exceeded |
| --- | --- | --- | --- |
| **CI duration** | Avg wall-clock time for a passing CI run on `main` | ≥ 20 min | Investigate build/test optimisation (caching, parallelism, dropped steps) |
| **CI failure rate** | `failed / total` completed runs on `main` | ≥ 20% | Investigate flaky tests, environment issues, or missing pre-commit gates |
| **PR lead time** | Avg time from PR opened to merged | ≥ 2 days | Identify review bottlenecks; consider async review SLAs |
| **Re-review cycles** | Avg number of extra review-request events per merged PR | ≥ 2/PR | Tighten pre-review quality gates (linting, typecheck, code-review skill) |
| **Time-to-merge** | Avg time from last approval to merge | ≥ 24 h | Reduce merge friction (squash-merge policy, required-check wait times) |

Healthy baseline: CI < 10 min, failure rate < 5%, lead time < 1 day, re-review cycles < 1, TTM < 2 h. Read the trend across periods — a spike around a major refactor is expected.
