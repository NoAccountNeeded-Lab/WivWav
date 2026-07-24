# Quick Start — Development Environment

**Prerequisites:** Docker, Node 26, pnpm 11

Pick one of the two paths below — both start api, web, ops, and scraper, so don't run both.

### Option A: local dev with hot reload (recommended while developing)

```bash
# One-time setup
pnpm install
pnpm db:generate
cp apps/api/.env.example apps/api/.env
cp apps/scraper/.env.example apps/scraper/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/ops/.env.example apps/ops/.env.local
cp packages/db/.env.example packages/db/.env

# apps/api refuses to start without CONFIG_ENCRYPTION_SECRET. Generate one and
# uncomment it in apps/api/.env with the value below:
openssl rand -hex 32

# apps/ops rejects operator login without OPS_ADMIN_PASSWORD set. Pick a local
# password and set it in apps/ops/.env.local (OPS_ADMIN_USERNAME defaults to
# "operator" if left unset):
# OPS_ADMIN_PASSWORD=<your local password>

# Each session
make dev       # starts Postgres, Valkey, Meilisearch in Docker, applies
               # migrations, then runs api, web, ops, and scraper locally with hot reload
```

| Service     | URL                   |
| ----------- | --------------------- |
| Web app     | http://localhost:4000 |
| API         | http://localhost:4001 |
| Ops app     | http://localhost:4002 |
| Meilisearch | http://localhost:7700 |

```bash
make down      # stop the Postgres/Valkey/Meilisearch containers started by make dev
```

### Option B: full Docker stack

```bash
# One-time setup
cp apps/api/.env.example apps/api/.env

# Each session
make up        # starts the entire stack in Docker — infra, api, web, ops, scraper,
               # Ollama, and observability. Builds images automatically on first run.
```

`CONFIG_ENCRYPTION_SECRET`, `OPS_SESSION_SECRET`, and `OPS_ADMIN_PASSWORD` all
have working defaults baked into `docker-compose.yml` for this path (operator
login defaults to `operator` / `changeme-local-dev-password`) — set your own
values for anything beyond local dev.

| Service     | URL                   |
| ----------- | --------------------- |
| Web app     | http://localhost:3000 |
| API         | http://localhost:3001 |
| Ops app     | http://localhost:3002 |
| Meilisearch | http://localhost:7700 |

```bash
make down      # stop all containers
```

Every ops page and admin action goes through the ops server's own session + BFF proxy — the browser never calls the API's `/admin/*` routes directly. See `docs/api-routes.md#admin-auth-boundary-fail-closed`.

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

## Scraper browser sandbox

The production scraper image runs both Node.js and Chromium as the dedicated
non-root `scraper` user (UID 10001). The application explicitly enables
Playwright's Chromium sandbox. Chromium creates its internal user namespace
under the pinned Playwright seccomp profile at
`docker/chromium-seccomp.json`; the profile extends Docker's allowlist with
`clone`, `setns`, and `unshare`, as recommended for crawling untrusted sites.
Do not add `--no-sandbox` or run the scraper image as root.

Docker Compose applies the seccomp profile, `--init`, and host IPC settings to
the scraper service. To build and verify the image directly:

```bash
docker build -f docker/scraper/Dockerfile -t wivwav-scraper:local .
docker run --rm --init --ipc=host \
  --security-opt seccomp=./docker/chromium-seccomp.json \
  wivwav-scraper:local node smoke.mjs
```

The smoke script fails unless the process is non-root, `sharp` can process an
image, the Chromium headless shell is the only installed browser, development
tools are absent, and sandboxed Chromium launches and closes successfully.
The seccomp profile is copied from
[Playwright v1.60.0](https://github.com/microsoft/playwright/blob/v1.60.0/utils/docker/seccomp_profile.json)
so its browser/runtime contract stays aligned with the workspace dependency.

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
