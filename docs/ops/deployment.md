# Production deployment

How a `main` build becomes a running production stack, and what that implies
for migration ordering and rollback.

## Pipeline (single workflow)

`.github/workflows/ci.yml` is the only workflow that touches `main` and GHCR.
There is no separate publish workflow and no staging registry:

1. `docker` (matrix: api, web, ops, worker, migrate) builds each service's
   **final** image stage exactly once — the same `runner`-stage (or, for
   `migrate`, single-stage) image that would run in production. On a push to
   `main` the built image is also saved as a workflow artifact.
2. `lint-typecheck`, `test`, and `restore-drill` run independently, in
   parallel with the build. `restore-drill` proves a PostgreSQL backup
   actually restores — see `docs/data/backup-restore.md`. `e2e` (E2E smoke)
   runs against the built `migrate`, `api`, and `web` images once
   `docker-done` succeeds.
3. `publish` runs only for a push to `main`, and only after `docker-done`,
   `lint-typecheck`, `test`, `restore-drill`, and `e2e` have all succeeded. It
   loads the artifacts from step 1 — never rebuilding — tags and pushes each
   one to GHCR by digest, then renders `docker-compose.release.yml` from the
   `docker-compose.prod.yml` template with the digests it just pushed. The
   manifest is verified (no placeholder digests) and persisted as a workflow
   artifact and as an asset of the `deploy-<commit-sha>` GitHub Release. It
   is not committed back to `main`: branch and merge-queue protections stay
   enabled. If rendering, verifying, or persisting fails, `publish` fails.

If any of those five gates fails — Docker builds, lint/typecheck, unit and
integration tests, the restore drill, or E2E smoke — `publish` does not run
and nothing is pushed to GHCR. The digest recorded in
the release manifest is always exactly the `docker` job's image the
other jobs exercised — never a respin built after the fact.

### What E2E does and doesn't prove about the published images

`publish` pushes the exact bytes the `docker` job built and saved as
artifacts. `e2e`, by contrast, rebuilds the `migrate`, `api`, and `web`
images from the GitHub Actions build cache rather than loading those
artifacts — same commit and cache scope give effectively identical layers,
but `e2e` is not itself proof that it ran the identical tar `publish` later
pushes. `e2e` also only exercises `migrate`, `api`, and `web`: `worker` and `ops` are built
but not exercised by any E2E flow. Gating `publish` on `e2e` is still a net
risk reduction — it stops production images from shipping while the core
user-facing flow is provably broken — but it is a three-service smoke check
gating five images, not a guarantee about every published service.

See `docs/design/merge-queue.md` for why E2E gates publishing here but is
not (yet) a required merge-queue check.

### If E2E flakes on a `main` push

`publish` simply does not run for that commit — no image is pushed and
no new release manifest is created (the previous `deploy-<sha>` release stays current). Use
**Re-run failed jobs** on that workflow run to retry `e2e` (and `publish`
once it turns green) without repeating the whole pipeline. This only works
while the `docker` job's image artifacts are still present; they are
uploaded with `retention-days: 1`, so once a day has passed since the
original run, re-run **all** jobs instead — the saved artifacts will have
expired and `publish` needs them.

## Ops logs with laptop-hosted observability

The authenticated Ops Logs page (`/ops/logs`) reads the API's `/admin/logs`
endpoint. The production API queries Loki using `LOKI_URL`; without that
setting, it defaults to `localhost:3100` inside the API container.

To use the existing laptop Obs containers for production logs:

1. Give the laptop a stable private LAN address. In the laptop's local,
   ignored Compose `.env`, set `LOKI_GATEWAY_BIND_ADDRESS` to that address and
   `LOKI_ALLOWED_SOURCE_CIDR` to the production host's LAN address with `/32`.
   Loki, Grafana, and the gateway itself remain loopback-only by default.
2. Recreate the gateway so Docker publishes its port only on that private address:

   ```bash
   docker compose --profile obs up -d --no-deps loki-gateway
   ```

   Loki itself remains bound to loopback on port 3100; the gateway accepts
   only the production host's source address on port 3101.
3. Set `LOKI_URL=http://<laptop-lan-ip>:3101` in the production deployment's
   ignored `.env.production` file. Apply the normal digest-pinned Compose file
   with `--no-deps api` to recreate only the API container and apply the
   runtime setting; no app image rebuild is needed.
4. Start the laptop-side remote log forwarder using the existing SSH target.
   It streams Docker logs from the remote WivWav Compose project into the
   laptop's local Loki push endpoint at `http://127.0.0.1:3100`; the gateway
   on port 3101 is reserved for API queries and does not accept pushes.
5. From the production host, verify `http://<laptop-lan-ip>:3101/ready` returns
   `ready`, then open
   `/ops/logs` in the authenticated Ops app. Queries are scoped to
   `project="wivwav"`; the collector includes `api`, `web`, `ops`, and
   `job-runner`, covering scheduled/BullMQ jobs and the separate worker.
   Database, cache, search, and observability infrastructure logs are excluded.
   Grafana remains available on the laptop at `http://localhost:3003`.

Rollback by removing the gateway settings from the laptop's ignored `.env`,
restoring the API's previous `LOKI_URL` value, and stopping the gateway and
recreating the API.
The Loki named volume and stored logs are retained. No router port-forward is
used at any point.

## Client-side API host resolution

`apps/web` builds one shared image per commit and promotes it across deploy
targets. Configure `NEXT_PUBLIC_API_URL` at container startup, for example
`https://api.wivwav.com`; no per-environment image rebuild is required.

`RootLayout` reads `getPublicApiBaseUrl()` from
`apps/web/src/lib/server-api-url.ts` and stamps the result onto
`<body data-api-url="...">`. Browser components read that attribute through
`getClientApiBaseUrl()` in `apps/web/src/lib/api-url.ts`. Server-side API
requests prefer `API_INTERNAL_URL`, so the internal Docker address is never
injected into the browser attribute. Unset or blank values fall back to the
local development API at `http://localhost:4001`; production Compose requires
a nonempty public URL.

The server helper destructures values from `process.env`. Keep
that runtime read: Next.js substitutes direct `NEXT_PUBLIC_*` environment
references at build time in server bundles as well as browser bundles.
Server rendering alone does not make a direct reference runtime-configurable.
The earlier #837 implementation still used that direct read; the live
Mac mini deployment consequently rendered an empty `data-api-url`, causing
facets and histograms to request the visitor's localhost (#1208).

The web image has no API URL build argument. To verify promotion, build once
with no API URL configured, start that image with the intended runtime
`NEXT_PUBLIC_API_URL`, and check that the rendered body's
`data-api-url` equals the runtime value. Then confirm Discover facet requests
use that host and return populated distributions. Roll back by restoring the
previous release manifest; no database migration is involved.

## Deploying

Production Compose requires `OPS_PUBLIC_ORIGIN` before deploy. Set it to the
exact public ops origin, including scheme and host (for example,
`https://ops.example.com`, without a path, query, or fragment), in
`.env.production`. The ops BFF rejects mutations when this value is missing or
malformed.

`docker-compose.prod.yml` is a **template**: its wivwav image digests are
all-zero placeholders and it is not deployable as committed (CI's
`scripts/release-manifest.sh verify` rejects it). The deployable,
digest-pinned definition is the `docker-compose.release.yml` asset of the
`deploy-<commit-sha>` GitHub Release created by `publish`. Every wivwav-owned
image is referenced by `@sha256:...` digest, never by `:latest` or a
branch/SHA tag, so a deploy is reproducible:

```bash
gh release download deploy-<commit-sha> -p docker-compose.release.yml
bash scripts/release-manifest.sh verify docker-compose.release.yml
docker compose -f docker-compose.release.yml --env-file .env.production config --quiet
docker compose -f docker-compose.release.yml --env-file .env.production pull
docker compose -f docker-compose.release.yml --env-file .env.production up -d --remove-orphans
```

(`gh release list` shows available commits; the same file is also a 90-day
`release-manifest-<sha>` workflow artifact.) Compose resolves each service to
its pinned digest; Docker only pulls layers it doesn't already have cached.
`COMPOSE_VALIDATE=1 bash scripts/release-manifest.sh selftest` exercises
render, verify, and `docker compose config`, and runs in CI on every PR.

## Third-party API credentials

Some sources (e.g. eBay Motors, #999) authenticate to a third-party API using
credentials stored in the `ConfigService` (`apps/api/src/services/config-service.ts`),
not `.env.production` or a Docker image. These are append-only, AES-256-GCM
encrypted rows in Postgres (`type: "secret"`), keyed by dot-notation name
(e.g. `ebay.motors.app-id`, `ebay.motors.cert-id`; see
`docs/risk/private-seller-data-policy.md` for what that source ingests), and are entirely separate from the deploy
pipeline above:

- They are **not** rebuilt, rotated, or touched by a `main` push, the CI
  pipeline, or `docker compose ... up`. Deploying a new image does not change
  them.
- They are set and updated by an operator through the ops config UI
  (`/ops/config`, password-protected — see `apps/ops/src/middleware.ts`),
  which calls `PUT /admin/config/:key` on the API directly. The API key
  secrets table there includes a per-row "Rotate" action for replacing a
  value without retyping its key/description.
- Each key holds exactly one value regardless of environment — there is no
  separate `ebay.motors.sandbox.app-id` vs. `ebay.motors.production.app-id`.
  Switching an environment (e.g. Sandbox → Production for eBay) means an
  operator logs into **that environment's** `/ops/config` and overwrites the
  existing value with the new one.
- Before enabling a credential-backed source against production traffic,
  confirm an operator has set its production-environment values via that
  environment's ops UI — this has no automated gate and is easy to forget
  since nothing in the deploy pipeline checks for it.
- `ebay.motors.environment` (`'production'` or `'sandbox'`, defaulting to
  `'sandbox'` when unset) is a separate, explicit config key that selects
  `api.ebay.com` vs `api.sandbox.ebay.com` — the credential keys themselves
  carry no sandbox/production marker, so this flag is the only thing that
  decides which eBay environment the Browse API calls actually hit.
- The eBay Motors `Source` row is seeded `status: 'disabled'` on first
  creation (`apps/api/src/sources/registry.ts`'s `DEFAULT_DISABLED_KEYS`) —
  it will not crawl on deploy even though its cron schedule is registered
  like every other source. Before enabling it in a given environment, an
  operator must set `ebay.motors.*` to that environment's real values (and
  `ebay.motors.environment` to match) via that environment's own ops UI,
  then flip the source to `active` from `/ops/sources`. There is no
  automated gate that verifies the config values are correct before that
  flip — only that the source stays off until someone does it.
- Every unique listing the Browse API search discovers costs a second call
  (`getItem`) — VIN, mileage, city/state, and the private/dealer seller
  signal only exist on that per-item detail call, not on the search
  response. eBay's default Browse API quota is **5,000 calls/day** per app
  (confirmed via the developer portal, 2026-10-01); `MAX_ITEMS_PER_RUN` is
  set to budget roughly half of that across the source's 4x/day cron,
  leaving headroom for 429 retries. Before raising `MAX_ITEMS_PER_RUN` or
  the cron frequency, re-check the actual quota and current utilization via
  the Developer Analytics API's `rate_limit`/`user_rate_limit` resources (or
  request a higher limit via the Application Growth Check) — don't assume
  the default still applies.

## Migration ordering

`migrate` always runs — and must complete — before `api`, `web`, or `ops`
start:

- `docker-compose.prod.yml` expresses this with `depends_on: migrate:
  condition: service_completed_successfully` on `api`, `web`, and `ops`.
- `migrate` runs `prisma migrate deploy`, which applies any pending
  migrations and exits `0`. If it exits non-zero, Compose does not start the
  dependent app containers — a broken migration fails the deploy instead of
  leaving apps running against a half-migrated schema.
- This means every schema change must be **backward compatible with the
  previous release's code for the duration of the rollout**: the old app
  containers are still serving traffic (or, at minimum, still exist as the
  rollback target) at the moment the new schema lands. Follow the
  expand/contract pattern from `docs/data/schema-conventions.md` — additive
  changes (new nullable columns, new tables) in the same release as the code
  that uses them; drop or rename only in a later release once nothing reads
  the old shape.

## Rollback compatibility

Rolling back means redeploying a previous release's manifest: download
`docker-compose.release.yml` from an earlier `deploy-<commit-sha>` release and
run the deploy steps above against it. This is **app-image
rollback only**; it does not run a migration in reverse.

- Because migrations are additive/expand-first (see above), the schema
  present after the latest migration is always a superset that older app
  code can still read from and write to. Rolling back app images to the
  prior release is safe without also rolling back the database.
- Never roll back past a migration that dropped or renamed a column/table
  the older app code depends on — at that point the schema and the older
  code are no longer compatible, and a real restore (schema migration
  rollback plus data reconciliation) is required instead of an image
  rollback. Treat contract (destructive) migrations as one-way: only ship
  them once you've confirmed no rollback target still needs the old shape.
- `migrate`'s image stays pinned in each prior release's manifest, so the
  schema state associated with any prior deploy is always reconstructable
  from the `deploy-<sha>` release that pinned it.

## Backups

Rollback (above) undoes a bad app deploy; it does not recover lost or
corrupted data. `docker-compose.prod.yml` runs a `pg-backup` sidecar that
takes scheduled `pg_dump` backups of `postgres`, and `scripts/restore-drill.sh`
is the scripted drill that proves those backups actually restore. See
`docs/data/backup-restore.md` for RPO/RTO, retention, access policy, and how
to run a restore. Valkey has no equivalent backup — see
`docs/data/valkey-state-audit.md` for why.

## Worker (job-runner)

The `worker` image is published to GHCR by digest like the others and pinned
in the release manifest. `job-runner` in `docker-compose.prod.yml` sits behind
the `worker` profile, so it never starts by default:

```bash
docker compose -f docker-compose.release.yml --profile worker up -d job-runner
```

`WORKER_TOKEN` is required with no default, and because compose interpolates
inactive profiles too, **every host must set it in `.env.production`**, even
one that never runs the worker. Set it to the same value as
`INTERNAL_API_SECRET`: the API's worker gateway authenticates workers with
`Authorization: Bearer {INTERNAL_API_SECRET}` (see
`apps/api/src/plugins/worker-gateway-ws.test.ts`). `COORDINATOR_URL` defaults
to `http://api:3001`; `WORKER_CAPABILITIES` and `WORKER_MAX_CONCURRENT_JOBS`
default to `chromium=true` and `2`. The release-manifest selftest validates
the manifest with and without `--profile worker`.

The container gets `shm_size` (`WORKER_SHM_SIZE`, default `1gb`) for Chromium
instead of host IPC, plus `WORKER_MEM_LIMIT` (default `2g`) and `WORKER_CPUS`
(default `1.5`). On small hosts lower `WORKER_MAX_CONCURRENT_JOBS` to `1`.
