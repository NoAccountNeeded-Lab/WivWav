import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { INDEX_NAME, toDocument } from '@wivwav/search'
import { getMeiliClient } from '../lib/meili.js'
import { report } from './job-progress.js'

const BATCH_SIZE = 1000

type VehicleAwareCountRow = {
  count: number | bigint
}

export async function runMeilisearchSyncJob(context?: JobContext): Promise<void> {
  const db = getDb()
  const client = getMeiliClient()
  const index = client.index(INDEX_NAME)

  const activeCountRows = await db.$queryRaw<VehicleAwareCountRow[]>`
    SELECT COUNT(DISTINCT COALESCE("vehicleId", id))::int AS count
    FROM listings
    WHERE status = 'active'
  `
  const activeCount = Number(activeCountRows[0]?.count ?? 0)

  await report(context, `[meili-sync] Full re-index started — ${activeCount} active vehicle group(s) in DB`, {
    stage: 'syncing',
    current: 0,
    total: activeCount,
  })

  let synced = 0
  let cursor: string | undefined

  for (;;) {
    const rows = await db.listing.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    })
    if (rows.length === 0) break

    await index.addDocuments(rows.map(toDocument), { primaryKey: 'id' })
    synced += rows.length
    cursor = rows[rows.length - 1]!.id

    await report(context, `[meili-sync] Synced ${synced} listing(s)…`, {
      stage: 'syncing',
      current: Math.min(synced, activeCount),
      total: activeCount,
    })

    if (rows.length < BATCH_SIZE) break
  }

  // Monitoring: Meilisearch stats report raw documents, while search results
  // collapse active vehicle groups via distinctAttribute.
  try {
    const stats = await index.getStats()
    const meiliCount = stats.numberOfDocuments
    await report(
      context,
      `[meili-sync] Done. ${synced} doc(s) upserted. DB has ${activeCount} active vehicle group(s); Meilisearch index has ${meiliCount} total document(s).`,
      { stage: 'complete', current: activeCount, total: activeCount },
    )
  } catch {
    await report(context, `[meili-sync] Done. ${synced} doc(s) upserted. (Stats check unavailable.)`, {
      stage: 'complete',
      current: synced,
      total: synced,
    })
  }

  await db.$disconnect()
}
