# Valkey State Audit

Required by decision D8 in the [#666 architecture gate](https://github.com/noaccountneeded-lab/wivwav/issues/666)
and issue #667: classify every state class WivWav keeps in Valkey, and record
a ratified decision on schedule-intent ownership so #667's backup work does
not accidentally imply Valkey needs the same durability guarantees as
PostgreSQL.

Valkey is configured with a persistent volume (`valkey_data`, both
`docker-compose.yml` and `docker-compose.prod.yml`) today, but that is an
accident of the default image configuration, not a documented guarantee. This
audit exists to make an explicit call: which of Valkey's contents actually
need to survive a restart or volume loss, and which are safe to lose.

## Method

Searched every `VALKEY_URL` / `QUEUE_REDIS_URL` consumer
(`apps/api/src/index.ts`, `apps/api/src/config.ts`,
`packages/queue/src/bullmq/connection.ts`) and every call site that reads or
writes through a `CacheService` (`apps/api/src/services/config-service.ts`,
`apps/api/src/services/listing-facets.ts`) or a `QueueAdapter`
(`packages/queue/src/bullmq/queue-adapter.ts`, consumed by
`apps/api/src/routes/admin.ts` and `apps/api/src/schedule-registration.ts`).
Two things that look Valkey-adjacent but are not were explicitly ruled out:
`packages/scraper-sources/src/util/robots-cache.ts` is an in-process `Map`, and
`apps/ops/src/lib/session.ts` is a signed cookie with no server-side store —
neither touches Valkey.

## State classes

| State class | What it holds | Reconstructable from PostgreSQL? | Classification |
| --- | --- | --- | --- |
| **BullMQ job data** (waiting/active/completed/failed/delayed job payloads across all `QUEUES.*`) | In-flight and recent work items — e.g. a pending detail-crawl job's `sourceId` | No, but disposable: a lost in-flight job is simply not retried; the next scheduled run re-enqueues equivalent work from source/listing state in PostgreSQL | **Ephemeral / disposable.** Losing this on a Valkey restart degrades one cycle of throughput, not correctness. |
| **BullMQ repeatable job definitions registered by the declarative source registry** (`buildDetailScheduleDefinitions` in `apps/api/src/schedule-registration.ts`) | Cron pattern, timezone, and `jobId` for the default per-source detail-crawl/detail-extract schedules | Yes — `reconcileSchedules()` re-derives and re-registers every one of these from `Source` rows in PostgreSQL on apps/api startup | **Ephemeral / self-healing.** Already effectively backed by PostgreSQL; a wiped Valkey is repaired automatically the next time apps/api boots. |
| **Operator-authored repeatable-schedule mutations** (`POST`/`PUT`/`DELETE /admin/repeatables/:queue` in `apps/api/src/routes/admin.ts`, exercised from `apps/ops/src/app/ops/schedules/SchedulesClient.tsx`) | A human operator disabling a schedule, changing its cron pattern, or adding one outside the default per-source set | **Yes.** Current intent is mirrored into append-only `config_entry` rows and replayed during reconciliation; Valkey only holds the live BullMQ copy | **Authoritative in PostgreSQL; runtime copy in Valkey.** |
| **`ConfigEntry` read-through cache** (`apps/api/src/services/config-service.ts`, key `config:<key>`, 60s TTL) | Cached copy of the latest `config_entry` row per key | Yes — `ConfigService.get()` falls back to PostgreSQL on a cache miss, and the TTL guarantees eventual consistency even on stale reads | **Ephemeral / disposable.** Pure cache; PostgreSQL (`config_entry`, already covered by the backup in `docs/data/backup-restore.md`) is authoritative. |
| **Listing facets cache** (`apps/api/src/services/listing-facets.ts`) | Cached facet-count aggregation for listing search filters | Yes — recomputed from `listings` in PostgreSQL on a cache miss | **Ephemeral / disposable.** Pure cache. |

## Decision: schedule-intent ownership

**Ratified:** Operator-authored repeatable-schedule mutations (enable /
disable / reschedule via `/admin/repeatables`) are the only Valkey-resident
state class that represents durable operator intent rather than disposable
runtime or cache state. Per D5 in #666 (single declarative source registry),
the fix is to **move that intent into PostgreSQL, not to add a Valkey backup
policy.**

Rationale:

- A Valkey backup/restore policy would have to special-case which keys
  matter (schedule intent) versus which are safe to discard (jobs, caches),
  duplicating the classification this document already does, and would still
  leave a window between a mutation and the next backup where an operator's
  change is unprotected.
- D5's declarative source registry is already the direction of travel for
  schedule definitions; extending it to carry operator overrides (e.g. a
  `Source.scheduleOverride` column or a small `schedule_override` table)
  gives the mutation the same durability, backup coverage, and restore-drill
  coverage as every other authoritative record, with no new backup mechanism
  to build or verify.
- Every other Valkey-resident state class in the table above is genuinely
  disposable or already self-healing from PostgreSQL, so no other class of
  Valkey state needs a durability guarantee.

**Consequence:** Valkey remains formally ephemeral. No backup job is added
for it, and `valkey_data`'s current persistence is retained only as a
performance optimization (avoids re-populating caches and re-registering
default schedules from a cold start), not as a durability guarantee — losing
the volume is expected to be recoverable by scraper restart plus the
self-healing repeatable-schedule registration.

**Implemented in #813:** `/admin/repeatables` now appends operator intent to
`config_entry`, and scraper startup loads that intent before reconciling
BullMQ schedules. Valkey remains disposable; a wiped volume is repaired from
PostgreSQL-backed intent instead of from registry defaults alone.
