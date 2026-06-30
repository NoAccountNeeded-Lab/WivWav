import { getDb } from '@wivwav/db'
import type { Listing } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { INDEX_NAME, selectRepresentative, toDocument } from '@wivwav/search'
import { getMeiliClient } from '../lib/meili.js'
import { report } from './job-progress.js'

const BATCH_SIZE = 1000

type VehicleAwareCountRow = {
  count: number | bigint
}

/**
 * Groups eligible listings by vehicleId, selects one deterministic
 * representative per verified group, and returns the slice of documents
 * to upsert for that batch.
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

export async function runMeilisearchSyncJob(context?: JobContext): Promise<void> {
  const db = getDb()
  const client = getMeiliClient()
  const index = client.index(INDEX_NAME)

  const activeCountRows = await db.$queryRaw<VehicleAwareCountRow[]>`
    SELECT COUNT(DISTINCT COALESCE("vehicleId", id))::int AS count
    FROM listings
    WHERE status = 'active'
      AND "publicationStatus" = 'eligible'
  `
  const activeCount = Number(activeCountRows[0]?.count ?? 0)

  await report(context, `[meili-sync] Full re-index started — ${activeCount} eligible active vehicle group(s) in DB`, {
    stage: 'syncing',
    current: 0,
    total: activeCount,
  })

  const clearTask = await index.deleteAllDocuments()
  const clearResult = await client.tasks.waitForTask(clearTask.taskUid, { timeout: 15_000 })
  if (clearResult.status !== 'succeeded') {
    throw new Error(
      `Meilisearch clear failed: task ${clearResult.uid} ended with status ${clearResult.status}`,
    )
  }

  // Buffer a full vehicle group across pages so that representative selection
  // across page boundaries is correct. Groups spanning more than BATCH_SIZE
  // listings are unlikely in practice but handled safely: the in-memory buffer
  // accumulates the group until it is no longer the tail group, then flushes.
  let pending: Listing[] = []
  let synced = 0
  let cursor: string | undefined

  for (;;) {
    const rows = await db.listing.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: {
        status: 'active',
        publicationStatus: 'eligible',
      },
      orderBy: { id: 'asc' },
    })

    const isLastPage = rows.length < BATCH_SIZE

    if (rows.length > 0) {
      pending.push(...rows)
      cursor = rows[rows.length - 1]!.id
    }

    // On non-final pages, hold back the tail vehicle group (its remaining
    // members may arrive in the next page). On the final page, flush all.
    let toFlush: Listing[]
    if (isLastPage) {
      toFlush = pending
      pending = []
    } else {
      const tailVehicleId = pending[pending.length - 1]?.vehicleId
      if (tailVehicleId) {
        // Split at the first occurrence of the tail vehicleId.
        const splitIdx = pending.findIndex((r) => r.vehicleId === tailVehicleId)
        toFlush = pending.slice(0, splitIdx)
        pending = pending.slice(splitIdx)
      } else {
        // Tail listing has no vehicleId — it is standalone; flush everything.
        toFlush = pending
        pending = []
      }
    }

    if (toFlush.length > 0) {
      const docs = selectRepresentativesForBatch(toFlush)
      await index.addDocuments(docs.map(toDocument), { primaryKey: 'id' })
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
  try {
    const stats = await index.getStats()
    const meiliCount = stats.numberOfDocuments
    await report(
      context,
      `[meili-sync] Done. ${synced} representative doc(s) upserted. DB has ${activeCount} eligible active vehicle group(s); Meilisearch index has ${meiliCount} total document(s).`,
      { stage: 'complete', current: activeCount, total: activeCount },
    )
  } catch {
    await report(context, `[meili-sync] Done. ${synced} representative doc(s) upserted. (Stats check unavailable.)`, {
      stage: 'complete',
      current: synced,
      total: synced,
    })
  }

  await db.$disconnect()
}
