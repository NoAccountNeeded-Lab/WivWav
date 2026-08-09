import type { WivWavLogger } from '@wivwav/logger'

/**
 * Structurally compatible with `@wivwav/queue`'s `JobContext`/`JobProgress`
 * (consumed by `@wivwav/scraper-sources`' `report()` and the ported engine
 * below) without depending on `@wivwav/queue` itself — that package pulls in
 * bullmq/ioredis, and this worker never talks to valkey (#952).
 */
export type JobProgress = string | number | boolean | object

export interface JobContext {
  logger?: WivWavLogger
  jobId?: string
  log(message: string): Promise<void>
  updateProgress(progress: JobProgress): Promise<void>
  runId?: string | null
}

/** Builds a JobContext that logs through the worker's own logger. */
export function createJobContext(logger: WivWavLogger, jobId: string): JobContext {
  return {
    logger,
    jobId,
    async log(message: string): Promise<void> {
      logger.info({ event: 'job.progress', jobId }, message)
    },
    async updateProgress(progress: JobProgress): Promise<void> {
      logger.debug({ event: 'job.progress', jobId, progress }, 'progress update')
    },
    runId: null,
  }
}
