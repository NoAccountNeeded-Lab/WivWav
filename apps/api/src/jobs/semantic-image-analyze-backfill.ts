/**
 * Semantic image-analysis backfill/report trigger (issue #798).
 *
 * Scans for listing images that are eligible for #796/#797's semantic
 * analysis (real vehicle photos, not placeholder/cross-vehicle clusters per
 * #503) and either reused or stale on `semanticAnalysisVersion`, then
 * reports counts (--report) or enqueues one `image-semantic-analyze` job per
 * eligible image (--apply). Mirrors `image-integrity-backfill.ts`'s
 * report/apply posture: always run --report first and review before --apply.
 *
 * Usage:
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-backfill.ts --report
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-backfill.ts --apply
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-backfill.ts --apply --source <sourceId>
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-backfill.ts --apply --limit 500
 *
 * --report mode:
 *   Counts eligible-and-unanalyzed images without enqueuing anything. No
 *   queue side-effects.
 *
 * --apply mode:
 *   Same scan, then enqueues one job per eligible image onto the
 *   `image-semantic-analyze` queue for the running scraper process's worker
 *   to pick up. Idempotent — an image already at the current
 *   `semanticAnalysisVersion` (including one processed by an earlier
 *   --apply run) is not re-enqueued; the worker also re-checks eligibility
 *   and currency at process time as a second guard.
 *
 * --source <sourceId>
 *   Scope the run to a single source for phased rollout.
 *
 * --limit N
 *   Enqueue at most N images (default: unlimited).
 *
 * Rollback:
 *   This job only enqueues BullMQ jobs and (via the worker) inserts
 *   append-only `listing_image_semantic_analysis` rows — it never mutates
 *   `Listing` fields. To revert a run's analysis rows:
 *
 *   DELETE FROM "listing_image_semantic_analysis" WHERE "semanticAnalysisVersion" = 1;
 *   UPDATE "listing_image" SET "semanticAnalysisVersion" = NULL WHERE "semanticAnalysisVersion" = 1;
 *
 * @module
 */

import '../lib/load-env.js'

import { getDb } from '@wivwav/db'
import { BullMQQueueFactory, QUEUES } from '@wivwav/queue'
import type { QueueAdapter } from '@wivwav/queue'
import {
  findEligibleImagesForSemanticAnalysis,
  type EligibleSemanticAnalysisImage,
} from '../images/semantic-analysis-eligibility.js'

export interface SemanticImageAnalyzeBackfillReport {
  /** Images eligible and enqueue-worthy (unanalyzed or stale on semanticAnalysisVersion). */
  eligible: number
  /** Of `eligible`, how many were actually enqueued (bounded by --limit). */
  enqueued: number
  scopedToSourceId?: string
  limited?: number
}

async function runSemanticImageAnalyzeBackfill(
  opts: {
    apply: boolean
    sourceId?: string
    limit?: number
  },
  /** Injected for tests; the CLI entry point below constructs a real queue. */
  queue?: QueueAdapter,
): Promise<SemanticImageAnalyzeBackfillReport> {
  const db = getDb()

  const images: EligibleSemanticAnalysisImage[] = await findEligibleImagesForSemanticAnalysis(db, {
    ...(opts.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  })

  const report: SemanticImageAnalyzeBackfillReport = {
    eligible: images.length,
    enqueued: 0,
    ...(opts.sourceId !== undefined ? { scopedToSourceId: opts.sourceId } : {}),
    ...(opts.limit !== undefined ? { limited: opts.limit } : {}),
  }

  if (opts.apply && images.length > 0 && queue) {
    for (const image of images) {
      await queue.add(
        { listingImageId: image.id },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      )
      report.enqueued++
    }
  }

  await db.$disconnect()
  return report
}

function printReport(report: SemanticImageAnalyzeBackfillReport, applied: boolean): void {
  const mode = applied ? 'APPLIED' : 'REPORT ONLY'
  const scope = report.scopedToSourceId ? ` [source: ${report.scopedToSourceId}]` : ''
  const limit = report.limited !== undefined ? ` [limit: ${report.limited}]` : ''
  console.log(`\n=== Semantic Image Analysis Backfill [${mode}]${scope}${limit} ===\n`)

  console.log(`Eligible images (unanalyzed or stale): ${report.eligible}`)

  if (!applied) {
    console.log(`\nThis was a dry run. No jobs were enqueued.`)
    console.log('Run with --apply to enqueue jobs (optionally --source <sourceId> / --limit N).')
  } else {
    console.log(`Jobs enqueued onto "${QUEUES.IMAGE_SEMANTIC_ANALYZE}": ${report.enqueued}`)
  }

  console.log('\n=== Done ===\n')
}

function parseArgs(argv: string[]): {
  apply: boolean
  sourceId?: string
  limit?: number
} {
  const applyMode = argv.includes('--apply')
  if (!applyMode && !argv.includes('--report')) {
    console.error(
      'Usage: semantic-image-analyze-backfill.ts --report | --apply [--source <sourceId>] [--limit N]',
    )
    process.exit(1)
  }
  const sourceIdx = argv.indexOf('--source')
  const sourceId = sourceIdx >= 0 ? argv[sourceIdx + 1] : undefined
  const limitIdx = argv.indexOf('--limit')
  const limitRaw = limitIdx >= 0 ? argv[limitIdx + 1] : undefined
  const limit = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined

  const result: { apply: boolean; sourceId?: string; limit?: number } = { apply: applyMode }
  if (sourceId !== undefined) result.sourceId = sourceId
  if (limit !== undefined && !isNaN(limit)) result.limit = limit
  return result
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2))
  const queueFactory = new BullMQQueueFactory()
  const queue = queueFactory.createQueue(QUEUES.IMAGE_SEMANTIC_ANALYZE)
  runSemanticImageAnalyzeBackfill(options, queue)
    .then(async (report) => {
      printReport(report, options.apply)
      await queueFactory.close()
    })
    .catch(async (err: unknown) => {
      console.error('Semantic image analysis backfill failed:', err)
      await queueFactory.close()
      process.exit(1)
    })
}

export { runSemanticImageAnalyzeBackfill }
