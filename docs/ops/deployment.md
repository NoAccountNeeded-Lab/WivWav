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
   actually restores — see `docs/data/backup-restore.md`.
3. `publish` runs only for a push to `main`, and only after `docker-done`,
   `lint-typecheck`, `test`, and `restore-drill` have all succeeded. It loads the artifacts
   from step 1 — never rebuilding — tags and pushes each one to GHCR by
   digest, then rewrites `docker-compose.prod.yml` with the digests it just
   pushed and commits that file back to `main` (`chore(deploy): pin published
   image digests ... [skip ci]`).

If any test job fails, `publish` does not run and nothing is pushed to GHCR.
The digest recorded in `docker-compose.prod.yml` is always exactly the image
the test jobs exercised — never a respin built after the fact.

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
