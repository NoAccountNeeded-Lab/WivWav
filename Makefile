COMPOSE = docker compose

.PHONY: up build down dev test test-integration typecheck lint build-app clean format logs \
        check-affected typecheck-affected lint-affected test-affected \
        sdlc-report restore-drill \
        db-push db-generate db-migrate db-seed db-studio \
        agents prune

# ── Docker stack ──────────────────────────────────────────────────────────────

## up     Start the complete Docker stack in the background — infra, api, web,
##        scraper, Ollama, and observability (Loki, Alloy, Grafana). Images are
##        built automatically on first run; use 'make build' to force a rebuild.
##        Grafana UI: http://localhost:3003
up:
	$(COMPOSE) --profile ai --profile obs up -d --remove-orphans

## build  Rebuild all Docker images without starting containers. Prunes
##        dangling images afterward so repeated rebuilds don't fill the
##        Docker VM disk (each rebuild leaves the old, now-untagged layers
##        behind). Run 'make prune' for a deeper clean of build cache/volumes.
build:
	$(COMPOSE) --profile ai --profile obs build
	docker image prune -f

## down   Stop all running containers and remove orphaned ones.
down:
	$(COMPOSE) --profile ai --profile obs down --remove-orphans

## logs   Tail live logs from all running containers. Press Ctrl-C to stop.
logs:
	$(COMPOSE) logs -f

## prune  Reclaim disk space: dangling images plus unused build cache. Run
##        this if 'docker system df' shows the Docker VM disk getting full.
##        Does not touch named volumes (Postgres/Meilisearch/etc data) or
##        images still referenced by docker-compose.yml.
prune:
	docker image prune -f
	docker builder prune -f

# ── Local development ─────────────────────────────────────────────────────────

## dev    Start backing services (Postgres, Valkey, Meilisearch) in Docker,
##        apply pending migrations, then run api, web, and scraper locally
##        with hot reload. Ctrl-C stops the apps; services keep running.
##        Run 'make down' to stop backing services when done.
dev:
	$(COMPOSE) up postgres valkey meilisearch -d
	@[ -f packages/db/.env ] || cp packages/db/.env.example packages/db/.env
	@[ -f apps/scraper/.env ] || cp apps/scraper/.env.example apps/scraper/.env
	pnpm db:migrate
	pnpm --filter "./packages/*" build
	pnpm dev

# ── Quality checks ────────────────────────────────────────────────────────────

## test              Run all unit tests across every package (Vitest, no containers).
test:
	pnpm test

## test-integration  Run scraper integration tests. Requires 'make dev' first
##                   for backing services (Postgres, Valkey).
test-integration:
	pnpm --filter @wivwav/scraper test:integration

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

## build-app         Build production bundles for all apps (Next.js, API, scraper).
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
