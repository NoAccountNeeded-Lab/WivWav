import {
  CRITICAL_JOB_OPTIONS,
  LISTING_SYNC_REBUILD_JOB_ID,
  QUEUES,
  getStringField,
  getBooleanField,
} from '@wivwav/queue'
import type { QueueFactory, WorkerAdapter } from '@wivwav/queue'
import { sourceScrapeJobResultSchema } from '@wivwav/types/scraper-gateway'
import type { WivWavLogger } from '@wivwav/logger'
import type { WorkerDispatcher } from './dispatcher.js'

/**
 * The three Chromium/DOM jobs from phase 1 (#948/#953).
 *
 * DETAIL_CRAWL and DETAIL_EXTRACT always require a chromium-capable worker —
 * their handlers (apps/worker/src/handlers/{detail-crawl,detail-extract}.ts)
 * take a BrowserService as a required, non-optional parameter today, so
 * there's no per-source distinction to make for them yet (#1041).
 *
 * SOURCE_SCRAPE is different: per-source requirement data now travels in the
 * job payload (`requiresBrowser`, set at enqueue time from
 * ScraperSourceRegistryEntry — see apps/api/src/sources/registry.ts's
 * buildSourceScrapeScheduleSources and the /sources/:id/run route in
 * routes/admin.ts) and is read via getBooleanField below instead of this
 * blanket table. This table is kept as the fallback for an old queued job
 * from before #1041 whose payload predates the field.
 */
export const CHROMIUM_GATEWAY_QUEUES: readonly string[] = [
  QUEUES.SOURCE_SCRAPE,
  QUEUES.DETAIL_CRAWL,
  QUEUES.DETAIL_EXTRACT,
]

/**
 * The 9 outbound-HTTP-only enrichment jobs from phase 2 (#962/#963/#964).
 * None touch Chromium/DOM; all require an httpEnrich-capable worker.
 */
export const HTTP_ENRICH_GATEWAY_QUEUES: readonly string[] = [
  QUEUES.NHTSA_RECALLS,
  QUEUES.NHTSA_COMPLAINTS,
  QUEUES.NHTSA_SAFETY_RATINGS,
  QUEUES.NHTSA_INVESTIGATIONS,
  QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
  QUEUES.VIN_ENRICH,
  QUEUES.MODEL_RESEARCH,
  QUEUES.FUELECONOMY_MSRP,
  QUEUES.DEALER_ENRICH,
]

/** Every queue apps/api's worker gateway consumes on behalf of apps/worker. */
export const GATEWAY_QUEUES: readonly string[] = [
  ...CHROMIUM_GATEWAY_QUEUES,
  ...HTTP_ENRICH_GATEWAY_QUEUES,
]

/**
 * Generous lock duration for dispatched gateway jobs (browser and
 * outbound-HTTP alike) — BullMQ automatically renews the lock while the
 * processor (our dispatch await) is running, so this only bounds how quickly
 * a *crashed* coordinator's jobs are re-polled.
 */
const GATEWAY_LOCK_DURATION_MS = 5 * 60_000

/**
 * BullMQ's own per-queue concurrency (packages/queue/src/policies.ts) was
 * tuned for a single in-process Chromium instance — 1 for SOURCE_SCRAPE, 2
 * for DETAIL_CRAWL/DETAIL_EXTRACT. The gateway's own real capacity limit is
 * `WorkerRegistry.pickWorker`'s per-worker/per-source accounting, so its
 * BullMQ Worker needs enough concurrency to never be the bottleneck ahead of
 * that — otherwise a fleet of N connected workers would still only ever have
 * 1-2 jobs in flight system-wide, silently capping throughput back to
 * single-machine levels regardless of how many workers are connected.
 */
const GATEWAY_WORKER_CONCURRENCY = 50

async function handleSourceScrapeCompletion(
  listingSyncQueue: ReturnType<QueueFactory['createQueue']>,
  listingResolveQueue: ReturnType<QueueFactory['createQueue']>,
  sourceId: string | undefined,
  runId: string | undefined,
  result: unknown,
  logger?: WivWavLogger,
): Promise<void> {
  const parsed = sourceScrapeJobResultSchema.safeParse(result)
  if (!parsed.success || !parsed.data.listingsChanged || sourceId === undefined) return
  // Mirrors apps/scraper/src/index.ts's SOURCE_SCRAPE handler: a full-catalog
  // search-index rebuild plus a publication re-resolve pass for this source,
  // both keyed to the run for lineage.
  await listingSyncQueue.add(
    { parentRunId: runId },
    { ...CRITICAL_JOB_OPTIONS, jobId: LISTING_SYNC_REBUILD_JOB_ID },
  )
  await listingResolveQueue.add({ sourceId, parentRunId: runId }, CRITICAL_JOB_OPTIONS)
  logger?.info(
    { sourceId, runId },
    '[worker-gateway] enqueued listing-sync + listing-resolve after source-scrape changes',
  )
}

/**
 * Registers apps/api as the BullMQ consumer for the gateway queues; each
 * processor forwards the job to a connected worker and awaits its completion
 * callback. Only call when WORKER_GATEWAY_ENABLED; after #953 (chromium jobs)
 * and #964 (outbound-HTTP jobs) these are the sole consumers for every
 * GATEWAY_QUEUES entry.
 */
export function registerGatewayWorkers(
  queueFactory: QueueFactory,
  dispatcher: WorkerDispatcher,
  logger?: WivWavLogger,
): WorkerAdapter[] {
  const listingSyncQueue = queueFactory.createQueue(QUEUES.LISTING_SYNC)
  const listingResolveQueue = queueFactory.createQueue(QUEUES.LISTING_RESOLVE)

  return GATEWAY_QUEUES.map((queueName) =>
    queueFactory.createWorker(
      queueName,
      async (data, context) => {
        const jobId = context.jobId
        if (jobId === undefined) {
          throw new Error(
            `[worker-gateway] ${queueName} job has no id; cannot build a correlation id`,
          )
        }
        const sourceId = getStringField(data, 'sourceId')
        // SOURCE_SCRAPE's chromium requirement is per-source (see the
        // CHROMIUM_GATEWAY_QUEUES doc comment); DETAIL_CRAWL/DETAIL_EXTRACT
        // stay on the static table unconditionally.
        const chromium =
          queueName === QUEUES.SOURCE_SCRAPE
            ? (getBooleanField(data, 'requiresBrowser') ?? CHROMIUM_GATEWAY_QUEUES.includes(queueName))
            : CHROMIUM_GATEWAY_QUEUES.includes(queueName)
        const result = await dispatcher.dispatch(queueName, jobId, data, {
          chromium,
          httpEnrich: HTTP_ENRICH_GATEWAY_QUEUES.includes(queueName),
          sourceId,
        })
        if (queueName === QUEUES.SOURCE_SCRAPE) {
          await handleSourceScrapeCompletion(
            listingSyncQueue,
            listingResolveQueue,
            sourceId,
            context.runId ?? undefined,
            result,
            logger,
          )
        }
      },
      {
        concurrency: GATEWAY_WORKER_CONCURRENCY,
        lockDuration: GATEWAY_LOCK_DURATION_MS,
        ...(logger !== undefined ? { logger } : {}),
      },
    ),
  )
}
