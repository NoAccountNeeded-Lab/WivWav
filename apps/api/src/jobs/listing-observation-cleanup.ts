import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'

export const LISTING_OBSERVATION_RETENTION_DAYS = 90
const BATCH_SIZE = 500
const MAX_ROWS_PER_RUN = 10_000
const MAX_BATCHES_PER_RUN = MAX_ROWS_PER_RUN / BATCH_SIZE

export async function runListingObservationCleanupJob(context?: JobContext): Promise<void> {
  const db = getDb()
  const cutoff = new Date(Date.now() - LISTING_OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  let deleted = 0

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN && deleted < MAX_ROWS_PER_RUN; batch++) {
    const rows = await db.listingObservation.findMany({
      where: { observedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
      take: Math.min(BATCH_SIZE, MAX_ROWS_PER_RUN - deleted),
    })
    if (rows.length === 0) break

    const result = await db.listingObservation.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    })
    deleted += result.count
    if (rows.length < BATCH_SIZE) break
  }

  if (deleted >= MAX_ROWS_PER_RUN) {
    const message = `[listing-observation-cleanup] Reached the ${MAX_ROWS_PER_RUN}-row per-run cap; older observations remain for the next run`
    context?.logger?.warn({ event: 'job.warning', deleted, cap: MAX_ROWS_PER_RUN }, message)
    await context?.log(message)
  }

  await report(
    context,
    `[listing-observation-cleanup] Deleted ${deleted} rows older than ${LISTING_OBSERVATION_RETENTION_DAYS} days`,
    { stage: 'complete', current: deleted, total: deleted },
  )
}
