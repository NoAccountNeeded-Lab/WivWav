import type { JobContext, JobProcessor } from '@wivwav/queue'
import type { JobRunFinishStats, JobRunRepository } from './job-run-repository.js'

function readStringField(data: unknown, field: string): string | null {
  if (data && typeof data === 'object' && field in data) {
    const value = (data as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

/**
 * Thrown by a processor that fails partway through a batch but still knows
 * how much of it succeeded before the failure (e.g. detail-extract's
 * per-page extraction loop). `withJobRunTracking` unwraps `.stats` and
 * persists it on the failed `JobRun` row alongside `errorMessage`, instead
 * of leaving `succeededCount`/`failedCount` null the way a plain `Error`
 * thrown mid-batch would.
 */
export class JobRunStatsError extends Error {
  readonly stats: JobRunFinishStats

  constructor(message: string, stats: JobRunFinishStats) {
    super(message)
    this.name = 'JobRunStatsError'
    this.stats = stats
  }
}

/**
 * A processor wrapped by `withJobRunTracking` may optionally resolve with
 * `succeededCount`/`failedCount` for the batch it just processed — see
 * `JobRunFinishStats`. Processors with no natural per-run count (most job
 * types) can keep resolving `void` as before.
 */
type TrackedJobProcessor<T> = (data: T, context: JobContext) => Promise<JobRunFinishStats | void>

/**
 * Wraps a BullMQ job processor so every execution of `jobType` is recorded
 * as a `JobRun` row (#933 lineage backbone): created in `running` status
 * before the processor runs, then marked `succeeded` or `failed` after.
 *
 * `sourceId` and `parentRunId` are read opportunistically off the job's own
 * data payload — present when the caller included them (see index.ts's
 * `queue.add()` call sites for spawned jobs). Jobs whose payload carries
 * neither are still recorded, just unscoped/root.
 *
 * The created run's id is attached to the context passed to the inner
 * processor as `context.runId`, so a processor that itself enqueues a
 * follow-on job (e.g. detail-extract or vin-enrich enqueuing listing-resolve)
 * can propagate it as that job's `parentRunId`, linking the two runs into one
 * pipeline tree.
 *
 * Compose with `withSentryCapture` as the outer wrapper — this function
 * rethrows after recording the failure, so Sentry still sees it:
 * `withSentryCapture(queueName, withJobRunTracking(queueName, jobRuns, processor))`.
 */
export function withJobRunTracking<T = unknown>(
  jobType: string,
  jobRuns: JobRunRepository,
  processor: TrackedJobProcessor<T>,
): JobProcessor<T> {
  return async (data: T, context: JobContext): Promise<void> => {
    const sourceId = readStringField(data, 'sourceId')
    const parentRunId = readStringField(data, 'parentRunId')
    const run = await jobRuns.start({ jobType, sourceId, parentRunId })
    const runContext: JobContext = { ...context, runId: run.id }

    try {
      const stats = await processor(data, runContext)
      if (stats) {
        await jobRuns.succeed(run.id, stats)
      } else {
        await jobRuns.succeed(run.id)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stats = err instanceof JobRunStatsError ? err.stats : undefined
      // Best-effort: a failure recording the failure must not mask the
      // original processor error, which is what actually needs to propagate
      // to BullMQ for retry/alerting.
      if (stats) {
        await jobRuns.fail(run.id, message, stats).catch(() => {})
      } else {
        await jobRuns.fail(run.id, message).catch(() => {})
      }
      throw err
    }
  }
}
