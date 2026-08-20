import { getDb, appendPrivateSellerDeletionAuditEntry } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { getMeiliClient } from '../lib/meili.js'
import { anonymizePrivateSellerListing, retentionCutoff } from '../services/private-seller-retention.js'
import { report } from './job-progress.js'

const BATCH_SIZE = 100

/**
 * Bounds how many batches one scheduled run drains, matching the
 * search-indexer-poll pattern (jobs/search-indexer-poll.ts): a large backlog
 * — including the initial backfill of every already-gone private-seller
 * listing past the retention window at deploy time — is drained over
 * several scheduled ticks instead of one unbounded run.
 */
const MAX_BATCHES_PER_RUN = 20

/**
 * #817 automated private-seller retention sweep.
 *
 * Idempotent by construction: each batch re-queries
 * `sellerType: 'private', status: 'gone', goneAt <= cutoff, retentionAppliedAt: null`
 * fresh, so a row drops out of the candidate set the moment it is
 * anonymized — no cursor or checkpoint needed, and a crashed/retried run
 * simply re-reads whatever is still outstanding.
 *
 * This same query — not a separate script — is what applies the policy to
 * the existing backlog of already-gone private-seller listings on first
 * deploy: nothing about the candidate query is scoped to "newly gone since
 * this job started existing", so the first several scheduled runs after
 * deploy bound-drain that backlog exactly like any other tick.
 *
 * Partial failure: one listing's anonymization failing does not abort the
 * batch — the error is logged, recorded in the audit trail, and the sweep
 * continues to the next candidate. A failed row stays a candidate (its
 * `retentionAppliedAt` was never set) and is retried on the next tick.
 */
export async function runPrivateSellerRetentionJob(context?: JobContext): Promise<void> {
  const db = getDb()
  const meili = getMeiliClient()
  const cutoff = retentionCutoff()

  let applied = 0
  let failed = 0

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const candidates = await db.listing.findMany({
      where: {
        sellerType: 'private',
        status: 'gone',
        goneAt: { lte: cutoff },
        retentionAppliedAt: null,
      },
      select: { id: true },
      take: BATCH_SIZE,
      orderBy: { goneAt: 'asc' },
    })
    if (candidates.length === 0) break

    for (const { id } of candidates) {
      try {
        const result = await anonymizePrivateSellerListing(db, meili, id)
        if (result.outcome === 'applied') {
          applied++
          await appendPrivateSellerDeletionAuditEntry(db, id, {
            action: 'automated-retention',
            outcome: 'applied',
            fieldsCleared: result.fieldsCleared,
          })
        }
      } catch (err) {
        failed++
        const errorMessage = err instanceof Error ? err.message : String(err)
        context?.logger?.error({ err, listingId: id }, '[private-seller-retention] Anonymization failed')
        await appendPrivateSellerDeletionAuditEntry(db, id, {
          action: 'automated-retention',
          outcome: 'failed',
          fieldsCleared: [],
          errorMessage,
        }).catch(() => {})
      }
    }

    if (candidates.length < BATCH_SIZE) break
  }

  const total = applied + failed
  await report(
    context,
    `[private-seller-retention] Anonymized ${applied} gone private-seller listing(s)${failed > 0 ? `, ${failed} failed` : ''}`,
    { stage: 'complete', current: total, total, success: applied, failed },
  )
}
