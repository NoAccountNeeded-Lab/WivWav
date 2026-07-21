import { getDb } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import type { Meilisearch } from 'meilisearch'
import { INDEX_NAME, syncListings } from '@wivwav/search'
import { getMeiliClient } from '../lib/meili.js'
import { report } from './job-progress.js'
import { rebuildMeilisearchIndex } from './meilisearch-sync.js'

/**
 * Single-owner incremental search indexer (#669, D3).
 *
 * This is the *only* steady-state writer of incremental changes to the
 * listings search projection. It replaces the previously scattered
 * `syncListings()` calls that ran from nine separate scraper mutation paths
 * (deduplicate, detail-crawl, detail-extract, geocode, listing-resolve,
 * match-vehicle-identity, vin-enrich, and the engine's gone-listing hook).
 *
 * Mechanism: a checkpointed poller over `(updatedAt, id)`, not a
 * transactional outbox. See docs/architecture/decisions/0001-search-projection-mechanism.md
 * for the full comparison and the conditions under which this choice holds
 * (no hard deletes; every mutation path uses a Prisma write that advances
 * `@updatedAt`).
 *
 * Ordering guarantee: the durable checkpoint only advances *after* the
 * corresponding Meilisearch write (via `syncListings`) has succeeded. If this
 * job crashes between the two, the next run re-reads the same batch from the
 * checkpoint and replays it — safe because `syncListings` recomputes
 * eligibility and group representation from the database on every call
 * (idempotent).
 */

const BATCH_SIZE = 500

/**
 * Bounds the number of batches processed per invocation so a single run
 * cannot run unboundedly long under heavy write volume — a large backlog is
 * drained over several scheduled ticks instead of one long-running job.
 */
const MAX_BATCHES_PER_RUN = 20

const CHECKPOINT_ID = 'listings'

/** Before any checkpoint exists, start from the beginning of time. */
const EPOCH = new Date(0)

interface Checkpoint {
  lastUpdatedAt: Date
  lastId: string
}

interface TouchedRow {
  id: string
  updatedAt: Date
}

async function loadCheckpoint(db: PrismaClient): Promise<Checkpoint> {
  const row = await db.searchIndexerCheckpoint.findUnique({ where: { id: CHECKPOINT_ID } })
  return row ? { lastUpdatedAt: row.lastUpdatedAt, lastId: row.lastId } : { lastUpdatedAt: EPOCH, lastId: '' }
}

async function advanceCheckpoint(db: PrismaClient, checkpoint: Checkpoint): Promise<void> {
  await db.searchIndexerCheckpoint.upsert({
    where: { id: CHECKPOINT_ID },
    create: { id: CHECKPOINT_ID, lastUpdatedAt: checkpoint.lastUpdatedAt, lastId: checkpoint.lastId },
    update: { lastUpdatedAt: checkpoint.lastUpdatedAt, lastId: checkpoint.lastId },
  })
}

/**
 * Repairs the all-or-nothing divergence produced when a persisted
 * Meilisearch volume outlives the authoritative listing catalog. The
 * checkpoint poller cannot observe hard-deleted rows, so without this guard
 * it would leave orphaned search cards pointing at permanent detail 404s
 * until the next scheduled full rebuild.
 *
 * Restricting the repair to an empty public catalog avoids turning ordinary
 * bounded incremental lag into repeated full rebuilds. Partial divergence is
 * still repaired by the scheduled full rebuild and reconciliation audit.
 */
async function repairOrphanedSearchCatalog(
  context: JobContext | undefined,
  db: PrismaClient,
  client: Meilisearch,
): Promise<void> {
  const publicListingCount = await db.listing.count({
    where: {
      status: 'active',
      publicationStatus: 'eligible',
      source: { is: { status: { not: 'disabled' } } },
    },
  })
  if (publicListingCount > 0) return

  let indexedDocumentCount: number
  try {
    const stats = await client.index(INDEX_NAME).getStats()
    indexedDocumentCount = stats.numberOfDocuments
  } catch {
    // A missing/unavailable index is handled by the existing incremental and
    // scheduled rebuild paths; there is no stale catalog to clear here.
    return
  }
  if (indexedDocumentCount === 0) return

  await report(
    context,
    `[search-indexer] Repairing ${indexedDocumentCount} orphaned search document(s); PostgreSQL has no public listings`,
    { stage: 'syncing', current: 0, total: indexedDocumentCount },
  )
  await rebuildMeilisearchIndex(context, db, client)
}

/**
 * Fetches one page of listings touched since `after`, ordered by
 * `(updatedAt, id)` so pagination stays stable even when many rows share the
 * same millisecond timestamp (a common outcome of batched updates).
 */
async function fetchTouchedPage(db: PrismaClient, after: Checkpoint): Promise<TouchedRow[]> {
  return db.$queryRaw<TouchedRow[]>`
    SELECT id, "updatedAt"
    FROM listings
    WHERE ("updatedAt", id) > (${after.lastUpdatedAt}, ${after.lastId})
    ORDER BY "updatedAt", id
    LIMIT ${BATCH_SIZE}
  `
}

export async function runSearchIndexerPollJob(context?: JobContext): Promise<void> {
  const db = getDb()
  const client = getMeiliClient()
  try {
    await repairOrphanedSearchCatalog(context, db, client)
    await pollOnce(context, db, client)
  } finally {
    await db.$disconnect()
  }
}

async function pollOnce(context: JobContext | undefined, db: PrismaClient, client: Meilisearch): Promise<void> {
  let checkpoint = await loadCheckpoint(db)
  let totalSynced = 0

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const rows = await fetchTouchedPage(db, checkpoint)
    if (rows.length === 0) break

    const ids = rows.map((row) => row.id)
    // Must complete before the checkpoint advances — see ordering guarantee above.
    await syncListings(ids, db, client)

    const last = rows[rows.length - 1]!
    checkpoint = { lastUpdatedAt: last.updatedAt, lastId: last.id }
    await advanceCheckpoint(db, checkpoint)
    totalSynced += rows.length

    if (rows.length < BATCH_SIZE) break
  }

  if (totalSynced > 0) {
    await report(context, `[search-indexer] Synced ${totalSynced} touched listing(s)`, {
      stage: 'complete',
      current: totalSynced,
      total: totalSynced,
    })
  }
}
