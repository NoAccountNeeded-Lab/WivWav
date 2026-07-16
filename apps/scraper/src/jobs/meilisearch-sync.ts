import { SourceStatus, getDb, Prisma } from '@wivwav/db'
import type { Listing, PrismaClient } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import type { Meilisearch } from 'meilisearch'
import { INDEX_NAME, configureIndexSettings, groupKeyOf, indexExists, selectRepresentative, toDocument } from '@wivwav/search'
import { getMeiliClient } from '../lib/meili.js'
import { report } from './job-progress.js'

const BATCH_SIZE = 1000
const TASK_TIMEOUT_MS = 15_000

/** Prefix for versioned rebuild-target indexes, e.g. "listings_v1751234567890". */
const VERSIONED_INDEX_PREFIX = `${INDEX_NAME}_v`

type VehicleAwareCountRow = {
  count: number | bigint
}

/**
 * A position in the `(groupKey, id)`-ordered id scan: either one row of a
 * fetched page, or the keyset cursor pointing just past the last row read.
 */
type GroupKeyPosition = {
  id: string
  groupKey: string
}

/**
 * Fetches one page of eligible listing ids ordered by `(groupKey, id)` —
 * NOT by `id` alone — so that every member of a vehicle group is contiguous
 * in the scan. `vehicleId` assignment is independent of listing `id`, so a
 * group's members can otherwise land in unrelated, non-adjacent batches;
 * each batch would then pick its own "representative", leaving duplicates
 * of the same vehicle group in the index. Keyset-paginated on the same
 * tuple to stay bounded and deterministic across the full catalog.
 */
async function fetchOrderedIdPage(
  db: PrismaClient,
  after: GroupKeyPosition | undefined,
): Promise<GroupKeyPosition[]> {
  const cursorClause = after
    ? Prisma.sql`AND (COALESCE(listings."vehicleId", listings.id), listings.id) > (${after.groupKey}, ${after.id})`
    : Prisma.empty
  return db.$queryRaw<GroupKeyPosition[]>`
    SELECT listings.id, COALESCE(listings."vehicleId", listings.id) AS "groupKey"
    FROM listings
    INNER JOIN sources ON sources.id = listings."sourceId"
    WHERE listings.status = 'active'
      AND listings."publicationStatus" = 'eligible'
      AND sources.status != 'disabled'
      ${cursorClause}
    ORDER BY COALESCE(listings."vehicleId", listings.id), listings.id
    LIMIT ${BATCH_SIZE}
  `
}

/**
 * Groups eligible listings by vehicleId, selects one deterministic
 * representative per verified group, and returns the slice of documents
 * to upsert for that batch. Callers must guarantee that no group in `rows`
 * has members still pending in a later page — see the `pending` buffer in
 * `runFullRebuild`.
 *
 * Ungrouped listings (no vehicleId) are returned as-is so candidates not
 * yet assigned to a vehicle remain separately searchable.
 */
function selectRepresentativesForBatch(rows: Listing[]): Listing[] {
  const byVehicleId = new Map<string, Listing[]>()
  const ungrouped: Listing[] = []

  for (const row of rows) {
    if (row.vehicleId) {
      const group = byVehicleId.get(row.vehicleId)
      if (group) group.push(row)
      else byVehicleId.set(row.vehicleId, [row])
    } else {
      ungrouped.push(row)
    }
  }

  const representatives: Listing[] = []
  for (const [, group] of byVehicleId) {
    representatives.push(selectRepresentative(group))
  }
  return [...representatives, ...ungrouped]
}

/** Awaits a Meilisearch task and fails closed if it did not succeed. */
async function waitForMeiliTask(client: Meilisearch, taskUid: number, label: string): Promise<void> {
  const result = await client.tasks.waitForTask(taskUid, { timeout: TASK_TIMEOUT_MS })
  if (result.status !== 'succeeded') {
    throw new Error(`Meilisearch ${label} failed: task ${result.uid} ended with status ${result.status}`)
  }
}

/**
 * Removes versioned rebuild-target indexes left behind by a run that crashed
 * before it could swap and clean up (e.g. process killed mid-rebuild). Runs
 * at the start of every rebuild so orphans never accumulate. Best-effort:
 * failing to delete a stray index does not block this run.
 */
async function cleanupOrphanedIndexes(client: Meilisearch, keepIndexName: string): Promise<void> {
  const { results } = await client.getIndexes({ limit: 100 })
  const orphans = results.filter((idx) => idx.uid.startsWith(VERSIONED_INDEX_PREFIX) && idx.uid !== keepIndexName)
  for (const orphan of orphans) {
    await client.deleteIndexIfExists(orphan.uid).catch(() => {})
  }
}

export async function runMeilisearchSyncJob(context?: JobContext): Promise<void> {
  const db = getDb()
  const client = getMeiliClient()
  // Build into a freshly created, uniquely named index and swap it into
  // service atomically once fully populated and validated (#669) — the live
  // index (`INDEX_NAME`) is never cleared, so in-flight queries never
  // observe an empty or partially rebuilt index.
  const versionedIndexName = `${VERSIONED_INDEX_PREFIX}${Date.now()}`

  try {
    await cleanupOrphanedIndexes(client, versionedIndexName)
    await configureIndexSettings(client, versionedIndexName)
    const index = client.index(versionedIndexName)
    await runFullRebuild(context, db, client, index)

    // First-ever rebuild: the live index may not exist yet. swapIndexes
    // requires both sides to exist, so create it (empty, but configured)
    // rather than special-casing the swap away.
    if (!(await indexExists(client, INDEX_NAME))) {
      await configureIndexSettings(client, INDEX_NAME)
    }

    const swapTask = await client.swapIndexes([{ indexes: [INDEX_NAME, versionedIndexName], rename: false }])
    await waitForMeiliTask(client, swapTask.taskUid, 'swapIndexes')

    // versionedIndexName now holds the *previous* live content post-swap;
    // it is no longer referenced by anything and can be dropped.
    await client.deleteIndexIfExists(versionedIndexName).catch((err: unknown) => {
      context?.logger?.warn({ err, versionedIndexName }, '[meili-sync] Failed to clean up the pre-swap index — non-fatal')
    })
  } catch (err) {
    // The rebuild target never went live — remove it rather than leaving a
    // half-built index for the next run's orphan cleanup to find.
    await client.deleteIndexIfExists(versionedIndexName).catch(() => {})
    throw err
  } finally {
    await db.$disconnect()
  }
}

async function runFullRebuild(
  context: JobContext | undefined,
  db: PrismaClient,
  client: Meilisearch,
  index: ReturnType<Meilisearch['index']>,
): Promise<void> {
  const activeCountRows = await db.$queryRaw<VehicleAwareCountRow[]>`
    SELECT COUNT(DISTINCT COALESCE(listings."vehicleId", listings.id))::int AS count
    FROM listings
    INNER JOIN sources ON sources.id = listings."sourceId"
    WHERE listings.status = 'active'
      AND listings."publicationStatus" = 'eligible'
      AND sources.status != 'disabled'
  `
  const activeCount = Number(activeCountRows[0]?.count ?? 0)

  await report(context, `[meili-sync] Full re-index started — ${activeCount} eligible active vehicle group(s) in DB`, {
    stage: 'syncing',
    current: 0,
    total: activeCount,
  })

  // Buffer a full vehicle group across pages so that representative selection
  // across page boundaries is correct. Groups spanning more than BATCH_SIZE
  // listings are unlikely in practice but handled safely: the in-memory buffer
  // accumulates the group until it is no longer the tail group, then flushes.
  let pending: Listing[] = []
  let synced = 0
  let cursor: GroupKeyPosition | undefined

  for (;;) {
    const idRows = await fetchOrderedIdPage(db, cursor)
    const isLastPage = idRows.length < BATCH_SIZE

    if (idRows.length > 0) {
      const idsInOrder = idRows.map((r) => r.id)
      // Re-check eligibility: a row can flip status/publicationStatus in the
      // gap between this fetch and the id scan above, and this fetch must
      // not silently include it just because it was eligible a moment ago.
      const fullRows = await db.listing.findMany({
        where: {
          id: { in: idsInOrder },
          status: 'active',
          publicationStatus: 'eligible',
          source: { is: { status: { not: SourceStatus.disabled } } },
        },
      })
      const byId = new Map(fullRows.map((row) => [row.id, row]))
      // Re-apply the (groupKey, id) order: `findMany({ id: { in } })` does not
      // preserve the input order, and that order is what keeps a group's
      // members contiguous for the tail-buffering logic below. Ids dropped
      // from `byId` (no longer eligible) fall out of `pending` here; the
      // final count-reconciliation check below fails closed if that changes
      // how many groups end up synced.
      const orderedRows = idsInOrder
        .map((id) => byId.get(id))
        .filter((row): row is Listing => row !== undefined)
      pending.push(...orderedRows)

      const lastIdRow = idRows[idRows.length - 1]!
      cursor = { groupKey: lastIdRow.groupKey, id: lastIdRow.id }
    }

    // On non-final pages, hold back the tail group (its remaining
    // members may arrive on the next page). On the final page, flush all.
    let toFlush: Listing[]
    if (isLastPage) {
      toFlush = pending
      pending = []
    } else if (pending.length === 0) {
      // Every row this page turned out ineligible by the time of the
      // re-check above; nothing to hold back or flush yet.
      toFlush = []
    } else {
      const tailGroupKey = groupKeyOf(pending[pending.length - 1]!)
      // Split at the first occurrence of the tail group's key.
      const splitIdx = pending.findIndex((row) => groupKeyOf(row) === tailGroupKey)
      toFlush = pending.slice(0, splitIdx)
      pending = pending.slice(splitIdx)
    }

    if (toFlush.length > 0) {
      const docs = selectRepresentativesForBatch(toFlush)
      const addTask = await index.addDocuments(docs.map(toDocument), { primaryKey: 'id' })
      await waitForMeiliTask(client, addTask.taskUid, 'addDocuments')
      synced += docs.length

      await report(context, `[meili-sync] Synced ${synced} representative doc(s)…`, {
        stage: 'syncing',
        current: Math.min(synced, activeCount),
        total: activeCount,
      })
    }

    if (isLastPage) break
  }

  // Monitoring: Meilisearch stats report raw documents; search results no
  // longer need distinctAttribute since only one doc per group is uploaded.
  const stats = await index.getStats()
  const meiliCount = stats.numberOfDocuments

  if (synced !== activeCount || meiliCount !== activeCount) {
    const message =
      `[meili-sync] Count mismatch — DB has ${activeCount} eligible active vehicle group(s), ` +
      `${synced} representative doc(s) were submitted, Meilisearch committed ${meiliCount} document(s). ` +
      'Blocking instead of reporting success.'
    await report(context, message, { stage: 'blocked', current: synced, total: activeCount })
    throw new Error(message)
  }

  await report(
    context,
    `[meili-sync] Done. ${synced} representative doc(s) upserted. DB has ${activeCount} eligible active vehicle group(s); Meilisearch index has ${meiliCount} total document(s).`,
    { stage: 'complete', current: activeCount, total: activeCount },
  )
}
