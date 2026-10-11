import type { QueueAdapter } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'
import type { ListingRepository, SourceIdRow } from '../repositories/index.js'
import { SOURCE_SCOPED_QUEUES, getQueueOrThrow, isJobForSource, latestByCreatedAt } from './admin-queue-helpers.js'

// Stall threshold: a stage with pending work but no completion within this
// window is flagged as stalled rather than just "busy". Kept generous
// relative to the slowest legitimate cadence (detail-crawl runs hourly;
// geocode/dedupe run nightly) so normal scheduling gaps do not false-positive.
const DEFAULT_STALL_THRESHOLD_MS = 6 * 60 * 60 * 1000

// Pipeline stages shown on the per-source view, in pipeline order. Each
// DB-derivable stage (detail-crawl, detail-extract, geocode, vin-enrich) maps
// to both a BullMQ queue (for failed-job counts) and a ListingRepository
// stage key (for pending/last-completed counts). source-scrape is
// represented separately since its state lives on the Source row itself.
const PIPELINE_STAGE_QUEUES: Record<'detail-crawl' | 'detail-extract' | 'geocode' | 'vin-enrich', string> = {
  'detail-crawl': QUEUES.DETAIL_CRAWL,
  'detail-extract': QUEUES.DETAIL_EXTRACT,
  'geocode': QUEUES.GEOCODE,
  'vin-enrich': QUEUES.VIN_ENRICH,
}

export interface SourcePipelineStage {
  stage: string
  queue: string
  pendingCount: number
  lastCompletedAt: Date | null
  failedCount: number
  /** Whether the failed-job count above is scoped to this source (true) or reflects the whole queue (false, for stages whose job payload has no sourceId). */
  failedScopedToSource: boolean
  stalled: boolean
  /** Id of the most recently failed job for this stage's queue, if any — used by the "Explain this error" action (#555). Only set when failedScopedToSource is true, since an unscoped job may belong to a different source. */
  latestFailedJobId: string | null
}

/**
 * Per-stage pending/failed/stall state for one source. Throws when a
 * dependency (queue, repository) is unavailable; the route maps that to 503.
 */
export async function buildSourcePipelineStages(
  source: SourceIdRow,
  listings: ListingRepository,
  queues: Map<string, QueueAdapter>,
  stallThresholdMs = DEFAULT_STALL_THRESHOLD_MS,
): Promise<SourcePipelineStage[]> {
  const [dbStages, sourceScrapeFailedJobs] = await Promise.all([
    listings.getSourcePipelineStages(source.id),
    (async () => {
      const q = getQueueOrThrow(queues, QUEUES.SOURCE_SCRAPE)
      const jobs = await q.getJobs(['failed'])
      return jobs.filter((job) => isJobForSource(job, source.id))
    })(),
  ])

  const dbStageQueueResults = await Promise.all(
    (Object.entries(PIPELINE_STAGE_QUEUES) as Array<[keyof typeof PIPELINE_STAGE_QUEUES, string]>).map(
      async ([stageKey, queueName]) => {
        const q = getQueueOrThrow(queues, queueName)
        const failedJobs = await q.getJobs(['failed'])
        const sourceScoped = SOURCE_SCOPED_QUEUES.has(queueName)
        const scopedFailures = sourceScoped
          ? failedJobs.filter((job) => isJobForSource(job, source.id))
          : failedJobs
        return {
          stageKey,
          queueName,
          failedCount: scopedFailures.length,
          failedScopedToSource: sourceScoped,
          // Only surface a job id to explain when the failure is known to
          // belong to this source — an unscoped queue's latest failure
          // may be for a different source entirely.
          latestFailedJobId: sourceScoped ? (latestByCreatedAt(scopedFailures)?.id ?? null) : null,
        }
      },
    ),
  )
  const failuresByStage = new Map(dbStageQueueResults.map((r) => [r.stageKey, r]))

  const stages: SourcePipelineStage[] = [
    {
      // source-scrape has no per-item "pending" count of its own (a scrape
      // either has or hasn't run) — its stage tile reports the last run
      // and any recent failures instead of a queue depth.
      stage: 'source-scrape',
      queue: QUEUES.SOURCE_SCRAPE,
      pendingCount: 0,
      lastCompletedAt: source.lastScrapedAt,
      failedCount: sourceScrapeFailedJobs.length,
      failedScopedToSource: true,
      stalled: source.status === 'needs_remapping' || source.status === 'error',
      latestFailedJobId: latestByCreatedAt(sourceScrapeFailedJobs)?.id ?? null,
    },
    ...dbStages.map((dbStage) => {
      const failures = failuresByStage.get(dbStage.stage)
      const stalled = dbStage.pendingCount > 0
        && (dbStage.lastCompletedAt === null || Date.now() - dbStage.lastCompletedAt.getTime() > stallThresholdMs)
      return {
        stage: dbStage.stage,
        queue: failures?.queueName ?? dbStage.stage,
        pendingCount: dbStage.pendingCount,
        lastCompletedAt: dbStage.lastCompletedAt,
        failedCount: failures?.failedCount ?? 0,
        failedScopedToSource: failures?.failedScopedToSource ?? false,
        stalled,
        latestFailedJobId: failures?.latestFailedJobId ?? null,
      }
    }),
  ]
  return stages
}
