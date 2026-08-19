/**
 * Backfill job: set missingFromCompleteCount = 1 for existing possibly_gone rows.
 *
 * Background
 * ----------
 * Before issue #514, the `missingFromCompleteCount` column did not exist.
 * After the migration runs the column defaults to 0 for all rows.
 *
 * The `resolveListingStatus()` function uses `missingFromCompleteCount = 0` to
 * mean "no source-index-absence evidence" and will restore a `possibly_gone`
 * listing to `active` when the detail page returns 200 without a sold/gone banner.
 *
 * Existing `possibly_gone` rows at count=0 were placed into that state by a
 * previous scrape run that did NOT find them in the source index — which IS
 * index-absence evidence. The safest migration is therefore to set their count
 * to 1 (one missed complete crawl observed), which:
 *
 *   - Prevents false active-restoration via detail-page 200 responses.
 *   - Leaves them one crawl away from the gone threshold (3), giving two more
 *     chances to reappear before being promoted to gone.
 *
 * Safety
 * ------
 * This job REPORTS candidate rows before changing anything (dry-run first),
 * then applies the update. It is idempotent: rows already at count >= 1 are
 * untouched. It will not transition any listing to gone.
 *
 * Deployment
 * ----------
 * Run once after deploying the #514 migration. The job is safe to re-run.
 */

import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'

export async function runBackfillMissingCountJob(context?: JobContext): Promise<void> {
  const db = getDb()

  try {
    // 1. Report stale candidates: possibly_gone rows with count=0, grouped by source.
    const candidates = await db.$queryRaw<Array<{ sourceId: string; count: number | bigint }>>`
      SELECT "sourceId", COUNT(*)::int AS count
      FROM listings
      WHERE status = 'possibly_gone'
        AND "missingFromCompleteCount" = 0
      GROUP BY "sourceId"
      ORDER BY count DESC
    `

    const totalCandidates = candidates.reduce((sum, row) => sum + Number(row.count), 0)

    await report(
      context,
      `[backfill-missing-count] Stale possibly_gone candidates (count=0): ${totalCandidates} rows across ${candidates.length} source(s): ${JSON.stringify(candidates.map(r => ({ sourceId: r.sourceId, count: Number(r.count) })))}`,
      { stage: 'reporting', current: 0, total: totalCandidates },
    )

    if (totalCandidates === 0) {
      await report(context, '[backfill-missing-count] No rows to backfill — done.', {
        stage: 'complete',
        current: 0,
        total: 0,
      })
      return
    }

    // 2. Apply: set missingFromCompleteCount = 1 for all possibly_gone rows at 0.
    //    Does NOT touch rows already at count >= 1, and does NOT promote to gone.
    const { count: updated } = await db.listing.updateMany({
      where: {
        status: 'possibly_gone',
        missingFromCompleteCount: 0,
      },
      data: {
        missingFromCompleteCount: 1,
      },
    })

    await report(
      context,
      `[backfill-missing-count] Updated ${updated} possibly_gone rows to missingFromCompleteCount=1. These rows will now require a complete crawl that includes them to restore to active.`,
      { stage: 'complete', current: updated, total: updated },
    )
  } finally {
    await db.$disconnect()
  }
}
