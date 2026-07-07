# PostgreSQL Backup and Restore

Ratified as decision D8 in the [#666 architecture gate](https://github.com/noaccountneeded-lab/wivwav/issues/666).
PostgreSQL is the authoritative store for WivWav. Its contents are not fully
re-scrapable: `listing_price_history` / `listing_mileage_history` /
`listing_conversion_history`, human vehicle-identity decisions
(`vehicle_identity_decision`), and encrypted application config
(`config_entry`) exist only in this database. If it is lost without a working
backup, that data is gone.

---

## What is backed up

The entire `wivwav` PostgreSQL database — every table in `packages/db/prisma/schema.prisma`.
There is no per-table selection: `pg_dump` in `-Fc` (custom) format captures
the whole database in one artifact, which keeps the restore drill (below)
simple and avoids silently missing a table added by a future migration.

## How backups run

`docker-compose.prod.yml` runs a `pg-backup` sidecar alongside `postgres`,
using the same `postgres:17-alpine` image (no new third-party image or
license). It executes `docker/postgres-backup/backup.sh`, which loops
forever inside the container:

1. `pg_dump -Fc --no-owner --no-privileges` the live database to
   `/backups/wivwav-<UTC timestamp>.dump.partial`, then renames it to
   `.dump` only on success — a mid-dump crash never leaves a truncated file
   under the "real" name.
2. Deletes backup files older than the retention window.
3. Sleeps until the next interval and repeats.

No separate cron daemon is needed — the loop lives entirely in the shell
script, matching the minimal-dependency pattern already used by the rest of
the compose stack.

`/backups` is the named Docker volume `postgres_backups`, distinct from
`postgres_data` (the live database's own volume) so a lost or corrupted data
volume does not also take the backups with it.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `BACKUP_INTERVAL_SECONDS` | `86400` (daily) | Time between backup attempts |
| `BACKUP_RETENTION_DAYS` | `14` | Age at which a backup file is pruned |

Set these in `.env.production` alongside the other `docker-compose.prod.yml`
variables (see `docs/ops/deployment.md`).

## RPO / RTO

- **Recovery Point Objective (RPO): up to `BACKUP_INTERVAL_SECONDS`** (24
  hours at the default). A restore recovers the database as of the most
  recent completed backup; any writes after that point are lost. Lower the
  interval if 24 hours of potential data loss is unacceptable — the sidecar
  and script make no assumption about cadence beyond "at least once per
  interval."
- **Recovery Time Objective (RTO): under 10 minutes for a database of this
  scale.** The [restore drill](#restore-drill) below performs a full
  migrate → seed → dump → restore → verify cycle in single-digit seconds
  against an empty schema; a production-sized restore is dominated by
  `pg_restore` I/O rather than orchestration overhead. Re-measure RTO against
  the current production database size periodically and update this number.

## Retention

Backups older than `BACKUP_RETENTION_DAYS` (default 14) are deleted by the
sidecar itself on every backup cycle. There is currently no secondary/offsite
copy — the `postgres_backups` volume lives on the same host as `postgres_data`.
**This means a total loss of the host (not just the database container) loses
both the live database and its backups.** Copying the `postgres_backups`
volume to offsite/object storage on a schedule is a known gap; track it as a
follow-up rather than silently assuming it is covered here.

## Access policy

- The `pg-backup` container uses the same database credentials as `api` and
  `migrate` (`POSTGRES_USER` / `POSTGRES_PASSWORD` from `.env.production`).
  It has no additional privileges beyond what those credentials already
  grant.
- `/backups` is a Docker-managed named volume, not a bind mount, so it is not
  directly browsable from the host without `docker run`/`docker cp` or
  `docker compose exec pg-backup sh`. Treat any extracted dump file as
  containing the same data as the live database — including dealer contact
  fields and encrypted secrets — and handle it under the same access
  restrictions as production database access (do not copy dumps to laptops
  or unmanaged storage; see `docs/ops/evidence-retention.md` for the parallel
  policy on scraped evidence).
- Dumps are `pg_dump`-format binary, not plaintext SQL, but they are **not
  separately encrypted**. `config_entry.encryptedValue` (AES-256-GCM,
  keyed by `CONFIG_ENCRYPTION_SECRET`) remains encrypted inside the dump —
  restoring a dump does not by itself expose secrets — but nothing else in
  the dump is encrypted at rest.

## Restore drill

`scripts/restore-drill.sh` is the scripted, repeatable restore drill required
by #667's acceptance criteria. It runs in two modes:

### Self-test mode (default — this is what CI runs)

```bash
pnpm install   # once, if not already done
bash scripts/restore-drill.sh
```

This needs no existing backup. It:

1. Starts an ephemeral "source" `postgres:17-alpine` container.
2. Applies the real Prisma migrations (`prisma migrate deploy`) against it —
   the same schema production runs.
3. Seeds a minimal fixture: a source, two listings, a vehicle, one row each
   in `listing_price_history` / `listing_mileage_history` /
   `listing_conversion_history`, a `vehicle_identity_decision` linking the
   two listings, and a `config_entry` secret encrypted with a generated
   `CONFIG_ENCRYPTION_SECRET`.
4. Dumps it with the identical `pg_dump` flags `backup.sh` uses in
   production.
5. Restores that dump into a second, clean, empty container with
   `pg_restore`.
6. Verifies the invariants named in #667:
   - `listing_price_history`, `listing_mileage_history`, and
     `listing_conversion_history` row counts are non-zero after restore.
   - A `vehicle_identity_decision` row is present.
   - The encrypted `config_entry` row decrypts to the original plaintext
     with the correct `CONFIG_ENCRYPTION_SECRET`, **and** fails to decrypt
     with a wrong one (negative control — proves the check isn't a false
     positive).
7. Tears down both containers and prints `PASS` with the elapsed time (a
   live RTO measurement for this drill's scale).

This mode is wired into CI (`.github/workflows/ci.yml`, job `restore-drill`)
so a change to the schema, the backup flags, or the config encryption
envelope that breaks restorability fails CI rather than being discovered
during an actual incident.

### Real-backup mode

```bash
bash scripts/restore-drill.sh --dump /path/to/wivwav-<timestamp>.dump
```

Pull an actual file from the `postgres_backups` volume (e.g.
`docker compose -f docker-compose.prod.yml cp pg-backup:/backups/<file> .`)
and pass it here to drill a real production backup. This mode restores it
into a clean ephemeral container and runs the same row-count and decrypt
checks, comparing against whatever data the dump actually contains rather
than a known fixture value. Run this periodically against a real backup, not
just the self-test — the self-test proves the mechanism works; a real-backup
drill proves the actual backups in the volume are restorable.

### Requirements

`docker`, `node`, and (self-test mode only) `pnpm` with dependencies already
installed (`pnpm install`), since self-test mode runs `prisma migrate deploy`
against `packages/db/prisma/schema.prisma`.

## Recovering into production

1. Stop the `api`, `web`, `ops`, and `scraper` containers so nothing writes
   to `postgres` during the restore (`migrate` running afterward is fine —
   it's a no-op against an already-current schema).
2. Copy the chosen dump file onto the `postgres` container or a host with
   network access to it.
3. `pg_restore --no-owner --no-privileges -U $POSTGRES_USER -d $POSTGRES_DB <dump>`
   against a **clean** database — `pg_restore` does not merge into
   existing data.
4. Run `prisma migrate deploy` (the `migrate` service) if the dump predates
   migrations that have since landed on `main`.
5. Restart `api`, `web`, `ops`, and `scraper`.
6. Spot-check `GET /health` and a handful of `/v1/listings` requests before
   declaring the incident resolved.
