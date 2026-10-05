COMPOSE = docker compose

.PHONY: up build disk-check down dev test test-integration typecheck lint build-app clean format logs \
        worker worker-build worker-count-check worker-remote worker-logs obs \
        check-affected typecheck-affected lint-affected test-affected \
        sdlc-report restore-drill \
        db-push db-generate db-migrate db-seed db-studio \
        agents prune

# ── Docker stack ──────────────────────────────────────────────────────────────

# Images the default stack builds. Built one at a time: four parallel
# 'pnpm install' runs filled the Docker VM disk (ENOSPC) and strain its RAM.
BUILD_SERVICES = migrate api ops web
BUILD_PROFILES ?= --profile ai --profile obs
# Minimum free space (GB) in the Docker VM before 'up'/'build' start building.
MIN_FREE_GB ?= 10
N ?= 1

## disk-check  Fail fast, before any build starts, when the Docker VM has less
##             than MIN_FREE_GB (default 10) free. Override with
##             'make build MIN_FREE_GB=5'.
disk-check:
	@disk=$$(docker run --rm alpine df -Pk /) || exit $$?; \
	free=$$(printf '%s\n' "$$disk" | awk 'NR==2 {print int($$4/1048576)}'); \
	case "$$free" in ''|*[!0-9]*) echo "Could not determine Docker VM free space." >&2; exit 1 ;; esac; \
	if [ "$$free" -lt "$(MIN_FREE_GB)" ]; then \
		echo "Docker VM has $${free}GB free (need $(MIN_FREE_GB)GB). Run 'make prune' to reclaim space, or lower the bar with MIN_FREE_GB=<n>." >&2; \
		exit 1; \
	fi

## up     Start the complete Docker stack in the background — infra, api, web,
##        ops, Ollama, and observability (Loki, Alloy, Grafana). Images that
##        are missing are built first, one at a time, after a free-disk check;
##        existing images are not rebuilt (use 'make build' to force that).
##        Grafana UI: http://localhost:3003
up: disk-check
	@for s in $(BUILD_SERVICES); do \
		docker image inspect "wivwav-$$s" >/dev/null 2>&1 || $(COMPOSE) --profile ai --profile obs build $$s || exit 1; \
	done
	$(COMPOSE) --profile ai --profile obs up -d --remove-orphans

## build  Rebuild the default-stack Docker images one at a time, without
##        starting containers, after a free-disk check. Prunes dangling images
##        afterward, even when a build fails, so repeated rebuilds don't fill
##        the Docker VM disk (each rebuild leaves the old, now-untagged layers
##        behind). Run 'make prune' for a deeper clean of unused build cache.
build: disk-check
	@status=0; \
	for s in $(BUILD_SERVICES); do \
		$(COMPOSE) $(BUILD_PROFILES) build $$s || { status=$$?; break; }; \
	done; \
	docker image prune -f; \
	exit $$status

## down   Stop all running containers (including the worker profile: job-runner
##        and its ops container) and remove orphaned ones.
down:
	$(COMPOSE) --profile ai --profile obs --profile worker down --remove-orphans

## logs   Tail live logs from all running containers. Press Ctrl-C to stop.
logs:
	$(COMPOSE) logs -f

## worker-build Rebuild the local worker stack sequentially without starting it.
worker-build:
	$(MAKE) build BUILD_SERVICES="migrate api ops job-runner" BUILD_PROFILES="--profile worker"

## worker-count-check Validate N before building or starting workers.
worker-count-check:
	@case "$(N)" in ''|*[!0-9]*|0*) \
		echo "N must be a positive integer (example: make worker N=3)." >&2; exit 1 ;; \
	esac

## worker Rebuild and start the local API, Ops, and Chromium-capable job runner.
##        The worker connects to the API, waits for jobs, and keeps running
##        with Docker restart policy enabled. Also starts Ops so an operator
##        can click Run Now without a second setup command.
##        Set the replica count with 'make worker N=3' (default 1).
worker: worker-count-check
	$(MAKE) worker-build
	$(COMPOSE) --profile worker up -d --no-build --scale job-runner=$(N) ops job-runner

## worker-remote Rebuild/start N job runners for a remote coordinator.
##               Required env:
##                 WORKER_COORDINATOR_URL=https://api.example.com
##                 WORKER_TOKEN=<worker bearer token>
worker-remote: worker-count-check
	@[ -n "$$WORKER_COORDINATOR_URL" ] || (echo "Set WORKER_COORDINATOR_URL to the coordinator API URL." >&2; exit 1)
	@[ -n "$$WORKER_TOKEN" ] || (echo "Set WORKER_TOKEN to the worker bearer token." >&2; exit 1)
	$(MAKE) build BUILD_SERVICES=job-runner BUILD_PROFILES="--profile worker"
	$(COMPOSE) --profile worker up -d --no-build --no-deps --scale job-runner=$(N) job-runner

## worker-logs Tail just the job-runner logs. Press Ctrl-C to stop following.
worker-logs:
	$(COMPOSE) --profile worker logs -f job-runner

## obs    Rebuild the local API dependencies, then start Loki, Alloy,
##        Prometheus, and Grafana. Missing upstream images are pulled.
##        Wait for health checks before returning. Grafana: http://localhost:3003
obs:
	$(MAKE) build BUILD_SERVICES="migrate api" BUILD_PROFILES="--profile obs"
	$(COMPOSE) --profile obs up -d --no-build --wait loki alloy prometheus grafana

## prune  Reclaim disk space: dangling images plus unused build cache. Run
##        this if 'docker system df' shows the Docker VM disk getting full.
##        Does not touch named volumes (Postgres/Meilisearch/etc data) or
##        images still referenced by docker-compose.yml.
prune:
	docker image prune -f
	docker builder prune -f

# ── Local development ─────────────────────────────────────────────────────────

## dev    Start backing services (Postgres, Valkey, Meilisearch) in Docker,
##        apply pending migrations, then run api, web, and ops locally
##        with hot reload. Ctrl-C stops the apps; services keep running.
##        Run 'make down' to stop backing services when done.
##        Inside the VS Code dev container, backing services are already
##        started by the container's own depends_on, and there is no Docker
##        CLI/socket in there to run this step anyway — so it's skipped.
dev:
	@[ -f /.dockerenv ] || $(COMPOSE) up postgres valkey meilisearch -d
	@[ -f packages/db/.env ] || cp packages/db/.env.example packages/db/.env
	pnpm db:migrate
	pnpm --filter "./packages/*" build
	pnpm dev

# ── Quality checks ────────────────────────────────────────────────────────────

## test              Run all unit tests across every package (Vitest, no containers).
test:
	pnpm test

## test-integration  Run API + search integration tests. Requires 'make dev'
##                   first for backing services (Postgres, Valkey, Meilisearch).
test-integration:
	pnpm test:integration

## typecheck         Run TypeScript type checking across all packages without
##                   emitting any files. Catches type errors before committing.
typecheck:
	pnpm typecheck

## lint              Run ESLint across all packages. Fails on any lint error.
lint:
	pnpm lint

## check-affected    Run typecheck, lint, and test only for packages changed
##                   relative to origin/main. Use during iteration for faster
##                   feedback only. Use 'make typecheck && make lint && make test'
##                   for the required full suite before finish.
check-affected:
	pnpm check:affected

## typecheck-affected  Typecheck only packages changed relative to origin/main.
typecheck-affected:
	pnpm typecheck:affected

## lint-affected       Lint only packages changed relative to origin/main.
lint-affected:
	pnpm lint:affected

## test-affected       Test only packages changed relative to origin/main.
test-affected:
	pnpm test:affected

## format            Auto-format all source files with Prettier.
format:
	pnpm format

## build-app         Build production bundles for all apps (Next.js, API).
build-app:
	pnpm build

## clean             Delete all build output (.next, dist, out) across every package.
clean:
	pnpm clean

# ── Database ──────────────────────────────────────────────────────────────────

## db-generate         Regenerate the Prisma client after schema changes. Run this
##                     whenever you edit packages/db/prisma/schema.prisma.
db-generate:
	pnpm db:generate

## db-migrate          Apply all pending migrations (prisma migrate deploy).
##                     Runs automatically in Docker; use this for local applies
##                     after pulling new migration files from teammates.
db-migrate:
	pnpm db:migrate

## db-migrate-create   Create a versioned migration from your schema changes.
##                     Run this after editing schema.prisma instead of db-push.
##                     Prisma will prompt for a name.
db-migrate-create:
	pnpm db:migrate:create

## db-push             Sync schema directly to DB without a migration file.
##                     Dev shortcut only — use db-migrate-create for changes
##                     that need to be tracked and deployed.
db-push:
	pnpm db:push

## db-seed             Load WAV listing fixtures for local dev.
##                     Idempotent — safe to run multiple times.
db-seed:
	pnpm --filter @wivwav/db db:seed

## db-studio           Open Prisma Studio in the browser for browsing and editing
##                     the local database. Requires 'make dev' first.
db-studio:
	pnpm --filter @wivwav/db db:studio

# ── Backup / restore ─────────────────────────────────────────────────────────

## restore-drill  Run the PostgreSQL restore drill (docs/data/backup-restore.md).
##                Self-test mode by default: builds an ephemeral source
##                database, seeds a fixture, dumps and restores it, and
##                verifies invariants. Pass DUMP=<path> to drill a real
##                backup file instead. Requires docker; self-test mode also
##                requires 'pnpm install' to have run.
##                Examples:
##                  make restore-drill
##                  make restore-drill DUMP=./wivwav-20260101T000000Z.dump
restore-drill:
	bash scripts/restore-drill.sh $(if $(DUMP),--dump $(DUMP),)

# ── SDLC metrics ─────────────────────────────────────────────────────────────

## sdlc-report  Print a delivery metrics report for CI duration, failure rate,
##              PR lead time, review cycles, and time-to-merge.
##              Requires GitHub CLI authenticated: gh auth status
##
##              Options (pass as env vars):
##                LOOKBACK_DAYS=N   Days of history to analyse (default: 30)
##              Examples:
##                make sdlc-report
##                make sdlc-report LOOKBACK_DAYS=90
sdlc-report:
	LOOKBACK_DAYS=$${LOOKBACK_DAYS:-30} bash scripts/sdlc-report.sh

# ── Agents CLI ────────────────────────────────────────────────────────────────

## agents      Run the agents CLI. Pass a command via ARGS.
##             Usage: make agents ARGS="<command> [options]"
agents:
	pnpm agents $(ARGS)
