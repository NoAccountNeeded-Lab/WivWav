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
