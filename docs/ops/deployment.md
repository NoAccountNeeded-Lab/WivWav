# Production deployment

How a `main` build becomes a running production stack, and what that implies
for migration ordering and rollback.

## Pipeline (single workflow)

`.github/workflows/ci.yml` is the only workflow that touches `main` and GHCR.
There is no separate publish workflow and no staging registry:

1. `docker` (matrix: api, web, ops, scraper, migrate) builds each service's
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
   one to GHCR by digest, then rewrites `docker-compose.prod.yml` with the
   digests it just pushed and commits that file back to `main`
   (`chore(deploy): pin published image digests ... [skip ci]`).

If any of those five gates fails — Docker builds, lint/typecheck, unit and
integration tests, the restore drill, or E2E smoke — `publish` does not run
and nothing is pushed to GHCR. The digest recorded in
`docker-compose.prod.yml` is always exactly the `docker` job's image the
other jobs exercised — never a respin built after the fact.

### What E2E does and doesn't prove about the published images

`publish` pushes the exact bytes the `docker` job built and saved as
artifacts. `e2e`, by contrast, rebuilds the `migrate`, `api`, and `web`
images from the GitHub Actions build cache rather than loading those
artifacts — same commit and cache scope give effectively identical layers,
but `e2e` is not itself proof that it ran the identical tar `publish` later
pushes. `e2e` also only exercises `migrate`, `api`, and `web`: `scraper` is
covered separately by the `docker` job's own smoke test, and `ops` is built
but not exercised by any E2E flow. Gating `publish` on `e2e` is still a net
risk reduction — it stops production images from shipping while the core
user-facing flow is provably broken — but it is a three-service smoke check
gating five images, not a guarantee about every published service.

See `docs/design/merge-queue.md` for why E2E gates publishing here but is
not (yet) a required merge-queue check.

### If E2E flakes on a `main` push

`publish` simply does not run for that commit — no image is pushed and
`docker-compose.prod.yml` is left pointing at the previous digest. Use
**Re-run failed jobs** on that workflow run to retry `e2e` (and `publish`
once it turns green) without repeating the whole pipeline. This only works
while the `docker` job's image artifacts are still present; they are
uploaded with `retention-days: 1`, so once a day has passed since the
original run, re-run **all** jobs instead — the saved artifacts will have
expired and `publish` needs them.

## Client-side API host resolution

`apps/web` builds one shared image per commit and promotes it across every
deploy target (see the pipeline above) — there is no per-environment
rebuild, and no single `NEXT_PUBLIC_API_URL` value is correct for every
target at build time. Next.js only substitutes `NEXT_PUBLIC_*` variables
into code that ends up in the browser bundle, at `next build` time; a
runtime `environment:` entry in Compose never reaches code that reads
`process.env.NEXT_PUBLIC_API_URL` inside a `'use client'` module. Before
#837, four browser-fetching components (`CategoryBarChart`,
`PriceHistogram`, `YearHistogram`, `MileageHistogram`) did exactly that, so
every published `web` image had the API host permanently baked in as
whatever `localhost` fallback `apps/web/src/lib/api-url.ts` defined at the
time the "Docker build (web)" CI job ran — never a real deploy target's API
host.

**Chosen approach: runtime injection via a server-rendered data attribute**,
not a BFF proxy and not a per-target image build:

- `RootLayout` (`apps/web/src/app/layout.tsx`) is a Server Component. It runs
  in the Node process on every request, so `getPublicApiBaseUrl()`
  (`apps/web/src/lib/api-url.ts`) reads the container's actual runtime
  `NEXT_PUBLIC_API_URL` — not a value inlined at build time — and stamps it
  onto `<body data-api-url="...">`.
- Browser code — `getClientApiBaseUrl()` in the same file — reads that
  attribute at call time instead of `process.env.NEXT_PUBLIC_API_URL`
  directly. This is the same pattern `FetchErrorMonitor` already used to
  detect the configured API host; #837 generalized it into a shared helper
  and applied it to the four components above.
- Net effect: the published `web` image is fully environment-agnostic for
  these client fetches. `docker-compose.prod.yml`'s
  `NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:?set NEXT_PUBLIC_API_URL}` is
  enough on its own — no rebuild per deploy target, no BFF hop for public,
  unauthenticated read endpoints (`/v1/listings/facets`,
  `/v1/conversion-brands`), and no asset-rewrite step at container start.

A same-origin BFF proxy (the pattern `apps/ops` uses for its
authenticated `/admin/*` surface via `/api/bff`) was considered and
rejected here: these `apps/web` endpoints are public, unauthenticated GETs,
so a proxy would add a same-origin hop and a second `apps/web` route
surface to maintain without closing any security gap the ops BFF exists
for. Rebuilding the image once per deploy target was also rejected — it
would give up the "build once, verified digest, promote everywhere" model
`publish` relies on (see the pipeline above).

`docker/web/Dockerfile` still declares `ARG NEXT_PUBLIC_API_URL` (added for
#815, CI's E2E job build step) and the "Docker build (web)" CI matrix job
still passes none. That is no longer a defect for the four components this
issue fixes: they never read the build-time value anymore. The `ARG` is
left in place because `getServerApiBaseUrl()` / `getPublicApiBaseUrl()`
still read `process.env.NEXT_PUBLIC_API_URL` server-side (correctly, at
request time) and E2E's compose stack still sets a matching runtime value —
removing the `ARG` is unnecessary churn, not a follow-up requirement.

**Audit: no real deployment has shipped yet.** `docker-compose.prod.yml`'s
image references are still the placeholder
`@sha256:0000...0000` digest and there is no
`chore(deploy): pin published image digests ...` commit in this repo's
history — `publish` (see the pipeline above) has never completed a real
run. So while the bug described in #837 was real from the day
`docker/web/Dockerfile` was authored, the Discover facet groups, state heat
map, and price/mileage/year histograms have not actually been broken for
any real deployed audience — only in the hypothetical first production
deploy, which this fix now precedes.

## Deploying

`docker-compose.prod.yml` is the in-repo, digest-pinned production
deployment definition. Every wivwav-owned image (`api`, `web`, `ops`,
`scraper`, `migrate`) is referenced by `@sha256:...` digest, never by
`:latest` or a branch/SHA tag, so a deploy is reproducible and a diff of that
file is a complete, auditable record of what changed:

```bash
git pull                                            # get the latest pinned digests
docker compose -f docker-compose.prod.yml \
  --env-file .env.production pull
docker compose -f docker-compose.prod.yml \
  --env-file .env.production up -d --remove-orphans
```

Compose resolves each service to its pinned digest; Docker only pulls layers
it doesn't already have cached.

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

Rolling back means redeploying a previous commit's pinned digests in
`docker-compose.prod.yml` — `git revert` (or manually restoring the prior
digest values) followed by the deploy steps above. This is **app-image
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
- `migrate`'s container stays in `docker-compose.prod.yml`'s history via git,
  so the schema state associated with any prior deploy is always
  reconstructable from the commit that pinned it.

## Backups

Rollback (above) undoes a bad app deploy; it does not recover lost or
corrupted data. `docker-compose.prod.yml` runs a `pg-backup` sidecar that
takes scheduled `pg_dump` backups of `postgres`, and `scripts/restore-drill.sh`
is the scripted drill that proves those backups actually restore. See
`docs/data/backup-restore.md` for RPO/RTO, retention, access policy, and how
to run a restore. Valkey has no equivalent backup — see
`docs/data/valkey-state-audit.md` for why.
