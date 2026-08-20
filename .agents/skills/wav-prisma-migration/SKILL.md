---
name: wav-prisma-migration
description: Make a safe Prisma schema or migration change in packages/db. Use for Prisma models, indexes, constraints, backfills, generated SQL, drift checks, or migration rollback planning.
user-invocable: false
---

# Prisma migration

There is no supported `db:reset`. A bad migration is not cheap to walk back — the only
recovery paths are a hand-written compensating migration or restoring the nightly `pg_dump`
backup (`docs/data/backup-restore.md`). Treat every migration as a one-way door.

## 1. Confirm a disposable local database

Before running `migrate:create`, `migrate`, or `migrate diff`, confirm without printing credentials
that `packages/db/.env` resolves `DATABASE_URL` to the local WivWav development database (normally
`localhost:5432/wivwav` from `packages/db/.env.example`). Stop if the host is remote, production-like,
unknown, or the local database cannot be distinguished safely. Never run this workflow against a
production database.

Start the local Postgres service if needed and create `packages/db/.env` from its example without
overwriting an existing file.

## 2. Edit the schema

`packages/db/prisma/schema.prisma`, following `docs/data/schema-conventions.md`:

- New table names: singular `snake_case` (`listing_price_history`, not `listing_price_histories`).
  Never rename an existing plural table (`sources`, `listings`, `scraper_runs`, `raw_pages`,
  `vehicle_models`, `recalls`, `complaints`, `safety_ratings`, `conversion_brands`,
  `conversion_products`, `nmea_dealers`).
- Model fields camelCase; DB column matches the field name unless `@map` is set.
- Enums: singular PascalCase (`SourceStatus`).

## 3. Generate the migration — never `db:push` for anything deployed

`db push` (`make db-push` / `pnpm db:push`) is a local dev shortcut only. For anything that will
ship, run `pnpm db:migrate:create --name <description>` (`make db-migrate-create`). This writes a
`.sql` file under `packages/db/prisma/migrations/` — commit it alongside the schema change, in the
same PR, not as a follow-up.

## 4. Review the generated SQL — don't just trust it

Prisma's diff can't express everything the schema needs. Precedent in this repo
(`packages/db/prisma/migrations/20260820052054_add_listing_retention_applied_at/migration.sql`): a partial index
(`WHERE "retentionAppliedAt" IS NULL`) isn't representable in `schema.prisma`'s `@@index`, so the
schema declares the unfiltered column set and the migration file is hand-edited to add the `WHERE`
clause — with a comment explaining why. Check the generated SQL against what you actually need
before committing it.

**Adding a `NOT NULL` column to a table with existing rows**: a single migration that adds
`NOT NULL` without a default will fail (or lock the table for the full backfill) once real rows
exist. Split it: add the column nullable (optionally with a default), backfill in a follow-up
migration or app-level job, then a later migration adds the `NOT NULL` constraint once every row
is populated. Don't collapse this into one migration against a populated table.

For a data-only backfill migration, create an empty draft with
`pnpm db:migrate:create --name backfill_<field> --create-only`, edit the generated
`migration.sql`, and review the qualified SQL before applying it. Generate each schema-changing
stage only after making the corresponding `schema.prisma` change; do not use an ordinary
schema-diff migration command as a substitute for the data-only stage.

If you hand-edit raw SQL (backfills, joins, CTEs), fully qualify every column reference — the same
rule `AGENTS.md` sets for application code applies here; an ambiguous `id` or `status` in a
migration is exactly as dangerous as one in a query.

## 5. Verify locally before pushing — this is what CI checks

Reconfirm the local database target before applying migrations, then run:

```bash
pnpm db:generate
pnpm --filter @wivwav/db typecheck
pnpm db:migrate
pnpm --filter @wivwav/db exec prisma migrate diff \
  --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code
```

The last command is the exact check CI runs after applying migrations (`.github/workflows/ci.yml`,
"Check for schema drift"): it diffs the live DB against `schema.prisma` and fails if they disagree,
which means a migration file is missing or wrong. A non-zero exit here means the same failure will
happen in CI — fix it before pushing, don't wait for the red run.

## 6. Rollback planning

Prisma does not generate down-migrations. State explicitly in the PR whether this migration is
safely reversible (e.g. an additive nullable column — drop it) or not (e.g. a backfill that
discards data, a constraint that would reject rows written after rollback). For anything not
cleanly reversible, say so and note that recovery falls back to the backup/restore drill in
`docs/data/backup-restore.md`.
