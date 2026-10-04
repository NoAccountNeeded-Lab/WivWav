import {
  CRITICAL_JOB_OPTIONS,
  LISTING_SYNC_REBUILD_JOB_ID,
  QUEUES,
  getStringField,
  getBooleanField,
  RetryJobSignal,
} from '@wivwav/queue'
import type { JobContext, QueueFactory, WorkerAdapter } from '@wivwav/queue'
import { sourceScrapeJobResultSchema } from '@wivwav/types/scraper-gateway'
import type { WivWavLogger } from '@wivwav/logger'
import { CapabilityEscalationError } from './dispatcher.js'
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

/**
 * How long an escalated SOURCE_SCRAPE job may wait for a Chromium-capable
 * worker before it fails (#1043). Without a bound, an escalated job with no
 * capable worker would requeue forever, which is the unbounded loop the
 * issue forbids. Generous because a laptop worker may simply be offline.
 */
export const ESCALATION_WAIT_LIMIT_MS = 60 * 60_000

/**
 * Short requeue delay after an escalation, so a capable worker picks it up
 * promptly (1s). Later "no capable worker" requeues use the 15s
 * `NO_WORKER_RETRY_DELAY_MS` from the dispatcher.
 *
 * Both delays are applied by the queue factory as a `worker.rateLimit(delayMs)`
 * on the whole SOURCE_SCRAPE consumer (not just this job), so an escalated job
 * that waits up to `ESCALATION_WAIT_LIMIT_MS` (60 minutes) for a browser worker
 * throttles every other source-scrape dispatch to one attempt per delay for that
 * whole time. Browser jobs with no capable worker already behave this way; the
 * existing queue API has no per-job delay, so this is intentionally unchanged.
 */
const ESCALATION_REQUEUE_DELAY_MS = 1_000

/**
 * Durable escalation record. Stored in the job's own persisted payload (via
 * `JobContext.updateData`) rather than in coordinator memory: it therefore
 * survives a coordinator restart, is keyed by the job's stable identity by
 * construction, is bounded by the job's lifetime, and is removed with the job on
 * completion, failure or cancellation — no separate pin table to leak or clean.
 */
interface CapabilityEscalationRecord {
  capability: 'chromium'
  reason: string
  /** Epoch ms of the first escalation; anchors the wait bound. */
  at: number
}

/**
 * Lenient on purpose: a record whose `at` is missing or not a number is read as
 * `at: 0`, which makes the wait bound (`now - at`) already exceeded, so a
 * corrupt record fails closed on the next "no capable worker" requeue rather
 * than waiting unbounded.
 */
function readEscalationRecord(data: unknown): CapabilityEscalationRecord | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const raw = (data as Record<string, unknown>)['capabilityEscalation']
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (record['capability'] !== 'chromium') return undefined
  return {
    capability: 'chromium',
    reason: typeof record['reason'] === 'string' ? record['reason'] : 'unspecified',
    at: typeof record['at'] === 'number' ? record['at'] : 0,
  }
}

interface EscalationOptions {
  /** Overridable for tests. */
  waitLimitMs?: number
  now?: () => number
}

/**
 * Dispatches a SOURCE_SCRAPE job and translates a worker's capability
 * escalation (#1043): persist the chromium requirement into the job payload and
 * requeue without consuming an attempt; the next dispatch then reads
 * `requiresBrowser: true`. A job that already escalated fails with an explicit
 * error instead of escalating again, and an escalated job that cannot find a
 * capable worker within the wait limit fails rather than requeueing forever.
 */
async function dispatchSourceScrape(
  dispatcher: WorkerDispatcher,
  jobId: string,
  data: unknown,
  context: JobContext,
  chromium: boolean,
  sourceId: string | undefined,
  options: EscalationOptions,
  logger?: WivWavLogger,
): Promise<unknown> {
  const now = options.now ?? Date.now
  const waitLimitMs = options.waitLimitMs ?? ESCALATION_WAIT_LIMIT_MS
  const existing = readEscalationRecord(data)
  const requirements = { chromium: existing !== undefined || chromium, httpEnrich: false, sourceId }
  try {
    return await dispatcher.dispatch(QUEUES.SOURCE_SCRAPE, jobId, data, requirements)
  } catch (err) {
    if (err instanceof CapabilityEscalationError) {
      if (existing !== undefined || requirements.chromium) {
        throw new Error(
          `[worker-gateway] source-scrape job ${jobId} requested '${err.escalation.capability}' ` +
            `again after it was already ${existing !== undefined ? 'escalated' : 'dispatched to a chromium-capable worker'}: ` +
            `${err.escalation.reason}; failing instead of re-dispatching`,
          { cause: err },
        )
      }
      if (context.updateData === undefined) {
        throw new Error(
          `[worker-gateway] source-scrape job ${jobId} requested '${err.escalation.capability}' ` +
            'but this queue backend cannot persist the requirement; failing',
          { cause: err },
        )
      }
      const record: CapabilityEscalationRecord = {
        capability: err.escalation.capability,
        reason: err.escalation.reason,
        at: now(),
      }
      // If this write rejects, the rejection propagates as an ordinary error:
      // the job consumes an attempt and BullMQ retries it (attempts is bounded,
      // 3 by default), which re-dispatches to a Chromium-free worker that blocks
      // and escalates again. A persistent persist failure therefore costs at
      // most the job's remaining attempts of blocked scrapes before it fails
      // with the persist error. The queue package has no established
      // unrecoverable/no-retry error pattern, so this is bounded and
      // documented rather than special-cased (#1043).
      await context.updateData({ requiresBrowser: true, capabilityEscalation: record })
      logger?.warn(
        { jobId, sourceId, capability: record.capability, reason: record.reason },
        '[worker-gateway] source-scrape escalated to a chromium-capable worker',
      )
      throw new RetryJobSignal(ESCALATION_REQUEUE_DELAY_MS, 'escalated to chromium-capable worker')
    }
    if (err instanceof RetryJobSignal && existing !== undefined) {
      const waitedMs = now() - existing.at
      if (waitedMs > waitLimitMs) {
        throw new Error(
          `[worker-gateway] source-scrape job ${jobId} was escalated to a chromium-capable ` +
            `worker ${Math.round(waitedMs / 1000)}s ago (${existing.reason}) but none completed it ` +
            `within ${Math.round(waitLimitMs / 1000)}s; failing`,
          { cause: err },
        )
      }
      logger?.warn(
        { jobId, sourceId, waitedMs, waitLimitMs, reason: err.message },
        '[worker-gateway] escalated source-scrape still waiting for a chromium-capable worker',
      )
    }
    throw err
  }
}

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
  escalationOptions: EscalationOptions = {},
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
        const result =
          queueName === QUEUES.SOURCE_SCRAPE
            ? await dispatchSourceScrape(
                dispatcher,
                jobId,
                data,
                context,
                chromium,
                sourceId,
                escalationOptions,
                logger,
              )
            : await dispatcher.dispatch(queueName, jobId, data, {
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
