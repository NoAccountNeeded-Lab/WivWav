import type { JobOptions } from './types.js'

/**
 * Default job options for critical job types.
 *
 * BullMQ defaults to `attempts: 1` (no retries). Callers that enqueue
 * critical jobs MUST spread these options so that transient failures do not
 * result in permanent job loss.
 *
 * Usage:
 *   await queue.add(data, CRITICAL_JOB_OPTIONS)
 */
export const CRITICAL_JOB_OPTIONS: JobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
}

/**
 * Fixed jobId for the Meilisearch full-catalog rebuild job. A burst of gone/
 * stale detections in a single run can each request a rebuild; using a fixed
 * id collapses them into a single pending job instead of queuing N serial
 * full rebuilds (each of which clears and re-adds the entire index).
 */
export const LISTING_SYNC_REBUILD_JOB_ID = 'listing-sync-rebuild'
