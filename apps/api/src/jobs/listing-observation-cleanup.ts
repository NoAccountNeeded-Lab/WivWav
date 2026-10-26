import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'

export const LISTING_OBSERVATION_RETENTION_DAYS = 90
const BATCH_SIZE = 500
const MAX_BATCHES_PER_RUN = 20

export async function runListingObservationCleanupJob(context?: JobContext): Promise<void> {
  const db = getDb()
  const cutoff = new Date(Date.now() - LISTING_OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  let deleted = 0

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const rows = await db.listingObservation.findMany({
      where: { observedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
    })
    if (rows.length === 0) break

    const result = await db.listingObservation.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    })
    deleted += result.count
    if (rows.length < BATCH_SIZE) break
  }

  await report(
    context,
    `[listing-observation-cleanup] Deleted ${deleted} rows older than ${LISTING_OBSERVATION_RETENTION_DAYS} days`,
    { stage: 'complete', current: deleted, total: deleted },
  )
}
