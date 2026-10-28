/**
 * Readiness backfill (#1161): computes `readinessBlockers` / `readinessComputedAt`
 * for active rows that never had them (rows ingested before the strict publish
 * gate existed). Pure DB work: no network, and `publicationStatus` is never
 * touched, so it only changes what the strict gate can see.
 *
 * Idempotent and resumable: only rows with `readinessComputedAt IS NULL` are
 * selected, so a re-run (or a retry after a crash) continues where it stopped.
 * Keyset-paged by id so memory stays bounded on small hosts.
 */
import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { computeReadiness } from '@wivwav/types/listing-readiness'
import { report } from './job-progress.js'

const BATCH_SIZE = 200

export async function runReadinessBackfill(context?: JobContext): Promise<{ updated: number }> {
  const db = getDb()
  let cursor: string | undefined
  let updated = 0

  for (;;) {
    const rows = await db.listing.findMany({
      // id > cursor, not a Prisma cursor: updated rows leave this where set.
      where: { status: 'active', readinessComputedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        detailScrapedAt: true,
        detailStaleAt: true,
        qualityCheckedAt: true,
        publicationStatus: true,
        images: true,
        vin: true,
        vehicleModelId: true,
        conversionType: true,
        city: true,
      },
    })
    if (rows.length === 0) break

    const now = new Date()
    const results = await db.$transaction(
      rows.map(({ id, ...input }) =>
        db.listing.updateMany({
          // The null guard keeps a concurrent resolve's fresher write intact.
          where: { id, readinessComputedAt: null },
          data: { readinessBlockers: computeReadiness(input).blockers, readinessComputedAt: now },
        }),
      ),
    )
    updated += results.reduce((n, r) => n + r.count, 0)
    cursor = rows[rows.length - 1]!.id
    await report(context, `[readiness-backfill] ${updated} row(s) updated`)
    if (rows.length < BATCH_SIZE) break
  }

  await report(context, `[readiness-backfill] done. ${updated} row(s) updated.`, {
    stage: 'complete',
    current: updated,
    total: updated,
  })
  return { updated }
}
