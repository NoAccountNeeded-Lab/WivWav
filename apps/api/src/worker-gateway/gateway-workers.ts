import { QUEUES } from '@wivwav/queue'
import type { QueueFactory, WorkerAdapter } from '@wivwav/queue'
import type { WivWavLogger } from '@wivwav/logger'
import type { WorkerDispatcher } from './dispatcher.js'

/**
 * The queues the gateway consumes in phase 1 (#948): the three Chromium jobs.
 * All require a chromium-capable worker.
 */
export const GATEWAY_QUEUES: readonly string[] = [
  QUEUES.SOURCE_SCRAPE,
  QUEUES.DETAIL_CRAWL,
  QUEUES.DETAIL_EXTRACT,
]

/**
 * Generous lock duration for dispatched browser jobs — BullMQ automatically
 * renews the lock while the processor (our dispatch await) is running, so
 * this only bounds how quickly a *crashed* coordinator's jobs are re-polled.
 */
const GATEWAY_LOCK_DURATION_MS = 5 * 60_000

function sourceIdOf(data: unknown): string | undefined {
  if (data !== null && typeof data === 'object') {
    const value = (data as Record<string, unknown>)['sourceId']
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * Registers apps/api as the BullMQ consumer for the gateway queues; each
 * processor forwards the job to a connected worker and awaits its completion
 * callback. Only call when WORKER_GATEWAY_ENABLED — the flag and the
 * scraper's in-process registrations are mutually exclusive (never two
 * consumer groups per queue).
 */
export function registerGatewayWorkers(
  queueFactory: QueueFactory,
  dispatcher: WorkerDispatcher,
  logger?: WivWavLogger,
): WorkerAdapter[] {
  return GATEWAY_QUEUES.map((queueName) =>
    queueFactory.createWorker(
      queueName,
      async (data, context) => {
        const jobId = context.jobId
        if (jobId === undefined) {
          throw new Error(`[worker-gateway] ${queueName} job has no id; cannot build a correlation id`)
        }
        await dispatcher.dispatch(queueName, jobId, data, {
          chromium: true,
          sourceId: sourceIdOf(data),
        })
      },
      {
        lockDuration: GATEWAY_LOCK_DURATION_MS,
        ...(logger !== undefined ? { logger } : {}),
      },
    ),
  )
}
