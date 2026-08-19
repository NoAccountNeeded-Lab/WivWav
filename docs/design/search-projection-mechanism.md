# Search projection mechanism: checkpointed poller vs. transactional outbox

Phase 0 of issue #669 (D3 from the #666 architecture gate). Recorded before
implementation began, per the issue's acceptance criteria.

## Context

PostgreSQL is authoritative for listings; Meilisearch holds a derived,
rebuildable search projection. Before this issue, three independent
mechanisms wrote to that projection: API startup ran a full `syncAll` on
every restart (clearing the live index first); a nightly scraper job ran a
second, differently-shaped full rebuild; and nine scraper mutation paths each
called `syncListings()` directly after their own writes. #666 ratified the
invariants — single projection owner, idempotent incremental updates,
versioned rebuild with atomic swap, no clear-then-repopulate on the live
index, no API-startup rebuild — but deferred the incremental-update
*mechanism* to this issue, per the rubric agreed in #666:

- commit/timestamp ordering across concurrent transactions
- identical timestamps within a batch
- non-Prisma (raw SQL) writers that could mutate indexed state silently
- checkpoint-after-index-commit ordering (crash safety)
- crash replay behavior
- readiness for a future hard-delete code path

## Options considered

### Option A — Transactional outbox

A dedicated `search_outbox` table is written in the same transaction as every
listing mutation (via a Prisma `$transaction` or a database trigger). A
single indexer worker polls the outbox, applies entries to Meilisearch, and
marks them processed. Guarantees atomic, ordered capture of every mutation
regardless of writer, including future hard deletes, independent of whether
the writer remembers to touch `updatedAt`.

Cost: a second table to maintain, a schema change coupled to every mutation
call site (or a DB trigger, which shifts logic out of the application layer
and out of TypeScript's type/test coverage), and additional operational
surface (outbox growth, cleanup/retention policy, dead-letter handling).

### Option B — Checkpointed `(updatedAt, id)` poller (chosen)

A single indexer job periodically scans `listings` for rows where
`(updatedAt, id) > (checkpoint.lastUpdatedAt, checkpoint.lastId)`, applies
them via the existing, already-tested `syncListings()` (which independently
re-derives eligibility and vehicle-group representative status from current
data — it is idempotent and safe to replay), and durably advances the
checkpoint only after the corresponding Meilisearch write succeeds.

## Evidence gathered for this codebase

- **Hard deletes:** none. A repository-wide search found no `listing.delete`
  / `deleteMany` callers outside the generated Prisma client. Listing
  eligibility is expressed entirely through `status` / `publicationStatus`
  transitions (`active` → `possibly_gone` → `gone`, `pending` →
  `eligible`/`quarantined`), all of which are ordinary field updates.
- **`updatedAt` coverage:** the `Listing` model declares
  `updatedAt DateTime @updatedAt` (`packages/db/prisma/schema.prisma`), so
  every Prisma `update`/`updateMany`/`upsert` call advances it automatically,
  including inside `$transaction`.
- **Non-Prisma writers:** one raw-SQL writer exists —
  `apps/api/src/jobs/listing-lock.ts` (`acquireListingLock`) — which sets
  only `processingLockedAt` via `UPDATE listings SET "processingLockedAt" =
  ...`. That column is not part of the search document and is never read by
  `toDocument()`/`syncListings()`, so this writer cannot silently invalidate
  the poller's capture guarantee today. Any *future* raw-SQL writer that
  touches an indexed field without advancing `updatedAt` would be a real gap;
  this is the concrete condition under which Option A should be revisited.
- **Ordering / identical timestamps:** millisecond-resolution timestamps can
  collide within a single batched `updateMany`. The poller's cursor is the
  tuple `(updatedAt, id)`, not `updatedAt` alone, so rows with identical
  timestamps are still totally ordered and none are skipped or
  double-counted across pages.
- **Crash safety:** the checkpoint advances only *after* `syncListings()`
  resolves for a batch (see `apps/api/src/jobs/search-indexer-poll.ts`).
  If the process crashes between the Meilisearch write and the checkpoint
  write, the next run re-reads and replays the same batch; replay is safe
  because `syncListings()` recomputes the correct document/deletion set from
  the database rather than trusting a stale in-memory batch.

## Decision

**Checkpointed `(updatedAt, id)` poller**, per the failure-mode rubric above:
no hard deletes exist, every mutation path is a Prisma write that advances
`updatedAt`, and the one raw-SQL writer does not touch indexed state. An
outbox would add a second source of truth and operational surface without a
matching correctness requirement in the current codebase.

**Revisit trigger:** if a hard-delete path is introduced, or a future writer
mutates indexed listing fields via raw SQL without advancing `updatedAt`,
switch to a transactional outbox — the poller's replay/idempotency guarantee
depends on both conditions holding.

## Resulting design (implemented in this issue)

- `apps/api/src/jobs/search-indexer-poll.ts` — the single steady-state
  owner of incremental search-index writes. Runs on a one-minute repeatable
  schedule (`QUEUES.LISTING_INDEX_POLL`), reads a durable checkpoint from the
  new `search_indexer_checkpoint` table, and calls the existing
  `syncListings()` per batch.
- All nine scraper mutation-path calls to `syncListings()`, and the API's
  startup `syncAll`, are removed. Mutations only need to commit to Postgres;
  the poller observes the change on its next tick.
- `apps/api/src/jobs/meilisearch-sync.ts` (the periodic full rebuild) now
  builds into a freshly created, uniquely named index, validates the
  submitted/committed document counts against the database, and only then
  calls Meilisearch `swapIndexes` to cut the live `listings` index over
  atomically. The live index is never cleared in place, so a query in flight
  during a rebuild never observes an empty or partially populated index.
- `GET /v1/listings` returns an explicit `503` error envelope
  (`SEARCH_UNAVAILABLE`) when the search backend is unavailable, instead of
  silently falling back to an unfiltered repository query.
