import 'dotenv/config'
// Sentry is disabled by default. When explicitly enabled, this import must stay
// before app imports so startup errors can be captured.
import { isSentryEnabled, Sentry } from './sentry.js'

process.on('uncaughtException', (err) => {
  if (!isSentryEnabled) {
    process.exit(1)
  }

  Sentry.captureException(err)
  void Sentry.flush(2000).finally(() => process.exit(1))
})

import { getDb, readCurrentScheduleIntents } from '@wivwav/db'
import { createLogger } from '@wivwav/logger'
import { BullMQQueueFactory, CRITICAL_JOB_OPTIONS, QUEUES } from '@wivwav/queue'
import {
  applyScheduleIntents,
  buildDetailScheduleDefinitions,
  reconcileSchedules,
  type ScheduleDefinition,
} from './schedule-registration.js'
import { runGeocodeJob } from './jobs/geocode.js'
import { runDeduplicateJob } from './jobs/deduplicate.js'
import { runVinEnrichJob } from './jobs/vin-enrich.js'
import { runNhtsaRecallsJob, type NhtsaRecallsJobData } from './jobs/nhtsa-recalls.js'
import { runNhtsaComplaintsJob, type NhtsaComplaintsJobData } from './jobs/nhtsa-complaints.js'
import {
  runNhtsaSafetyRatingsJob,
  type NhtsaSafetyRatingsJobData,
} from './jobs/nhtsa-safety-ratings.js'
import {
  runNhtsaInvestigationsJob,
  type NhtsaInvestigationsJobData,
} from './jobs/nhtsa-investigations.js'
import {
  runNhtsaManufacturerCommunicationsJob,
  type NhtsaManufacturerCommunicationsJobData,
} from './jobs/nhtsa-manufacturer-communications.js'
import { runVehicleStatsRefreshJob } from './jobs/vehicle-stats-refresh.js'
import { runConversionBrandsSeedJob } from './sources/conversion-brands.js'
import { runNmedaDealersSeedJob } from './sources/nmeda-dealers.js'
import { runModelResearchJob } from './jobs/model-research.js'
import { runMeilisearchSyncJob } from './jobs/meilisearch-sync.js'
import { runSearchIndexerPollJob } from './jobs/search-indexer-poll.js'
import { runListingResolveJob, type ListingResolveJobData } from './jobs/listing-resolve.js'
import { runRawPageCleanupJob } from './jobs/rawpage-cleanup.js'
import { runDealerEnrichJob } from './jobs/dealer-enrich.js'
import { runFuelEconomyMsrpJob, type FuelEconomyMsrpJobData } from './jobs/fueleconomy-msrp.js'
import {
  runSemanticImageAnalyzeJob,
  type SemanticImageAnalyzeJobData,
} from './jobs/semantic-image-analyze.js'
import { withSentryCapture } from './lib/capture-job-error.js'
import { withJobRunTracking } from './lib/job-run-tracking.js'
import { PrismaJobRunRepository } from './lib/job-run-repository.js'
import {
  buildDetailScheduleSources,
  buildSourceScrapeScheduleSources,
  registerSources,
} from './sources/registry.js'
import {
  resolveScraperRuntimeMode,
  shouldRegisterSchedules,
  shouldStartWorkers,
} from './runtime-mode.js'

const db = getDb()
const logger = createLogger({
  service: 'scraper',
  env: process.env['NODE_ENV'] ?? 'development',
})

// #933 lineage backbone: one JobRun row per job execution, across every job
// type registered below — see lib/job-run-tracking.ts.
const jobRuns = new PrismaJobRunRepository(db)

const runtimeMode = resolveScraperRuntimeMode()

/** Read a string config value from the DB. Falls back to null if unavailable. */
async function readConfigValue(key: string): Promise<string | null> {
  try {
    const row = await db.configEntry.findFirst({
      where: { key },
      orderBy: { createdAt: 'desc' },
    })
    if (!row || row.value === null) return null
    return typeof row.value === 'string' ? row.value : null
  } catch {
    return null
  }
}

// --- Queue setup ---

const queueFactory = new BullMQQueueFactory()
let shutdownPromise: Promise<void> | undefined

function shutdown(signal: NodeJS.Signals): Promise<void> {
  shutdownPromise ??= (async () => {
    logger.info({ signal }, 'Shutdown signal received')

    try {
      await queueFactory.close()
      await db.$disconnect()
      logger.info('Scraper shutdown complete')
      if (isSentryEnabled) {
        await Sentry.flush(2000)
      }
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'Scraper shutdown failed')
      if (isSentryEnabled) {
        await Sentry.flush(2000)
      }
      process.exit(1)
    }
  })()

  return shutdownPromise
}

process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))

// --- Source registration ---
// Upserts each registry entry's Source row so schedule-building below
// (SOURCE_SCRAPE and detail-pages schedules) always has row data to work
// from. Adapter instances are no longer constructed here — apps/api's worker gateway
// dispatches SOURCE_SCRAPE/DETAIL_CRAWL/DETAIL_EXTRACT to apps/worker, which
// owns adapter construction (#953).
const registeredSources = await registerSources(db)

const scrapeQueue = queueFactory.createQueue(QUEUES.SOURCE_SCRAPE)
const crawlQueue = queueFactory.createQueue(QUEUES.DETAIL_CRAWL)
const extractQueue = queueFactory.createQueue(QUEUES.DETAIL_EXTRACT)
const geocodeQueue = queueFactory.createQueue(QUEUES.GEOCODE)
const deduplicateQueue = queueFactory.createQueue(QUEUES.DEDUPLICATE)
const vinEnrichQueue = queueFactory.createQueue(QUEUES.VIN_ENRICH)
const nhtsaRecallsQueue = queueFactory.createQueue(QUEUES.NHTSA_RECALLS)
const nhtsaComplaintsQueue = queueFactory.createQueue(QUEUES.NHTSA_COMPLAINTS)
const nhtsaSafetyRatingsQueue = queueFactory.createQueue(QUEUES.NHTSA_SAFETY_RATINGS)
const nhtsaInvestigationsQueue = queueFactory.createQueue(QUEUES.NHTSA_INVESTIGATIONS)
const nhtsaManufacturerCommunicationsQueue = queueFactory.createQueue(
  QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
)
const vehicleStatsRefreshQueue = queueFactory.createQueue(QUEUES.VEHICLE_STATS_REFRESH)
const conversionBrandsSeedQueue = queueFactory.createQueue(QUEUES.CONVERSION_BRANDS_SEED)
const nmedaDealersSeedQueue = queueFactory.createQueue(QUEUES.NMEDA_DEALERS_SEED)
const modelResearchQueue = queueFactory.createQueue(QUEUES.MODEL_RESEARCH)
const listingSyncQueue = queueFactory.createQueue(QUEUES.LISTING_SYNC)
const listingIndexPollQueue = queueFactory.createQueue(QUEUES.LISTING_INDEX_POLL)
const listingResolveQueue = queueFactory.createQueue(QUEUES.LISTING_RESOLVE)
const rawPageCleanupQueue = queueFactory.createQueue(QUEUES.RAWPAGE_CLEANUP)
const dealerEnrichQueue = queueFactory.createQueue(QUEUES.DEALER_ENRICH)
const fuelEconomyMsrpQueue = queueFactory.createQueue(QUEUES.FUELECONOMY_MSRP)
// No local binding: nothing in this process enqueues onto this queue — only
// the #798 backfill script (a separate process/factory) does. Registering it
// here still makes the BullMQ Queue instance visible to shutdown()'s close().
queueFactory.createQueue(QUEUES.IMAGE_SEMANTIC_ANALYZE)

function registerWorkers(): void {
  // Workers — each processor is wrapped with withSentryCapture(withJobRunTracking(...))
  // so that every execution both reports failures to Sentry and is recorded
  // as a JobRun row (#933 lineage backbone), innermost tracking first so
  // Sentry still sees the rethrown error. Explicit type parameters on
  // withSentryCapture preserve the same type safety as the original
  // createWorker<T> call sites.
  //
  // SOURCE_SCRAPE, DETAIL_CRAWL, and DETAIL_EXTRACT have no worker here —
  // apps/api's worker gateway is their sole consumer, dispatching to
  // apps/worker (#953 cutover; see worker-registration.ts for the tested
  // list). This process still creates their Queue instances above and adds
  // their repeatable jobs below — scheduling and worker registration are
  // independent concerns.
  queueFactory.createWorker(
    QUEUES.GEOCODE,
    withSentryCapture(
      QUEUES.GEOCODE,
      withJobRunTracking(QUEUES.GEOCODE, jobRuns, (_data: unknown, context) =>
        runGeocodeJob(context),
      ),
    ),
    { lockDuration: 120_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.DEDUPLICATE,
    withSentryCapture(
      QUEUES.DEDUPLICATE,
      withJobRunTracking(QUEUES.DEDUPLICATE, jobRuns, (_data: unknown, context) =>
        runDeduplicateJob(context),
      ),
    ),
    { lockDuration: 120_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.VIN_ENRICH,
    withSentryCapture(
      QUEUES.VIN_ENRICH,
      withJobRunTracking(QUEUES.VIN_ENRICH, jobRuns, (_data: unknown, context) =>
        runVinEnrichJob(context, listingResolveQueue),
      ),
    ),
    { lockDuration: 300_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.NHTSA_RECALLS,
    withSentryCapture(
      QUEUES.NHTSA_RECALLS,
      withJobRunTracking(QUEUES.NHTSA_RECALLS, jobRuns, (data: NhtsaRecallsJobData, context) =>
        runNhtsaRecallsJob(context, data),
      ),
    ),
    { lockDuration: 300_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.NHTSA_COMPLAINTS,
    withSentryCapture(
      QUEUES.NHTSA_COMPLAINTS,
      withJobRunTracking(
        QUEUES.NHTSA_COMPLAINTS,
        jobRuns,
        (data: NhtsaComplaintsJobData, context) => runNhtsaComplaintsJob(context, data),
      ),
    ),
    { lockDuration: 600_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.NHTSA_SAFETY_RATINGS,
    withSentryCapture(
      QUEUES.NHTSA_SAFETY_RATINGS,
      withJobRunTracking(
        QUEUES.NHTSA_SAFETY_RATINGS,
        jobRuns,
        (data: NhtsaSafetyRatingsJobData, context) => runNhtsaSafetyRatingsJob(context, data),
      ),
    ),
    { lockDuration: 600_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.NHTSA_INVESTIGATIONS,
    withSentryCapture(
      QUEUES.NHTSA_INVESTIGATIONS,
      withJobRunTracking(
        QUEUES.NHTSA_INVESTIGATIONS,
        jobRuns,
        (data: NhtsaInvestigationsJobData, context) => runNhtsaInvestigationsJob(context, data),
      ),
    ),
    { lockDuration: 600_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
    withSentryCapture(
      QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
      withJobRunTracking(
        QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
        jobRuns,
        (data: NhtsaManufacturerCommunicationsJobData, context) =>
          runNhtsaManufacturerCommunicationsJob(context, data),
      ),
    ),
    { lockDuration: 600_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.VEHICLE_STATS_REFRESH,
    withSentryCapture(
      QUEUES.VEHICLE_STATS_REFRESH,
      withJobRunTracking(QUEUES.VEHICLE_STATS_REFRESH, jobRuns, (_data: unknown, context) =>
        runVehicleStatsRefreshJob(context),
      ),
    ),
    { lockDuration: 60_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.CONVERSION_BRANDS_SEED,
    withSentryCapture(
      QUEUES.CONVERSION_BRANDS_SEED,
      withJobRunTracking(QUEUES.CONVERSION_BRANDS_SEED, jobRuns, (_data: unknown, context) =>
        runConversionBrandsSeedJob(context),
      ),
    ),
    { lockDuration: 60_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.NMEDA_DEALERS_SEED,
    withSentryCapture(
      QUEUES.NMEDA_DEALERS_SEED,
      withJobRunTracking(QUEUES.NMEDA_DEALERS_SEED, jobRuns, (_data: unknown, context) =>
        runNmedaDealersSeedJob(context),
      ),
    ),
    { lockDuration: 60_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.MODEL_RESEARCH,
    withSentryCapture(
      QUEUES.MODEL_RESEARCH,
      withJobRunTracking(QUEUES.MODEL_RESEARCH, jobRuns, (_data: unknown, context) =>
        runModelResearchJob(context),
      ),
    ),
    { lockDuration: 600_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.LISTING_SYNC,
    withSentryCapture(
      QUEUES.LISTING_SYNC,
      withJobRunTracking(QUEUES.LISTING_SYNC, jobRuns, (_data: unknown, context) =>
        runMeilisearchSyncJob(context),
      ),
    ),
    { lockDuration: 300_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.LISTING_INDEX_POLL,
    withSentryCapture(
      QUEUES.LISTING_INDEX_POLL,
      withJobRunTracking(QUEUES.LISTING_INDEX_POLL, jobRuns, (_data: unknown, context) =>
        runSearchIndexerPollJob(context),
      ),
    ),
    { lockDuration: 120_000, logger },
  )
  queueFactory.createWorker<ListingResolveJobData>(
    QUEUES.LISTING_RESOLVE,
    withSentryCapture<ListingResolveJobData>(
      QUEUES.LISTING_RESOLVE,
      withJobRunTracking<ListingResolveJobData>(QUEUES.LISTING_RESOLVE, jobRuns, (data, context) =>
        runListingResolveJob(data, context),
      ),
    ),
    { lockDuration: 120_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.RAWPAGE_CLEANUP,
    withSentryCapture(
      QUEUES.RAWPAGE_CLEANUP,
      withJobRunTracking(QUEUES.RAWPAGE_CLEANUP, jobRuns, (_data: unknown, context) =>
        runRawPageCleanupJob(context),
      ),
    ),
    { lockDuration: 120_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.DEALER_ENRICH,
    withSentryCapture(
      QUEUES.DEALER_ENRICH,
      withJobRunTracking(QUEUES.DEALER_ENRICH, jobRuns, (_data: unknown, context) =>
        runDealerEnrichJob(context),
      ),
    ),
    { lockDuration: 300_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.FUELECONOMY_MSRP,
    withSentryCapture(
      QUEUES.FUELECONOMY_MSRP,
      withJobRunTracking(
        QUEUES.FUELECONOMY_MSRP,
        jobRuns,
        (data: FuelEconomyMsrpJobData, context) => runFuelEconomyMsrpJob(context, data),
      ),
    ),
    { lockDuration: 600_000, logger },
  )
  queueFactory.createWorker(
    QUEUES.IMAGE_SEMANTIC_ANALYZE,
    withSentryCapture(
      QUEUES.IMAGE_SEMANTIC_ANALYZE,
      withJobRunTracking(
        QUEUES.IMAGE_SEMANTIC_ANALYZE,
        jobRuns,
        (data: SemanticImageAnalyzeJobData, context) => runSemanticImageAnalyzeJob(data, context),
      ),
    ),
    { lockDuration: 60_000, logger },
  )
}

if (shouldStartWorkers(runtimeMode)) {
  registerWorkers()
}

// --- Repeatable schedules ---
// BullMQ/Valkey owns the schedule; no node-cron process needed.
// On startup we only add a schedule if it isn't already in BullMQ, so that
// changes made via the ops UI (/ops/schedules) survive scraper restarts.

const schedulerSource = registeredSources[0]
if (!schedulerSource) {
  throw new Error('No scraper sources are registered')
}
const tz = schedulerSource.row.timezone

const SCHEDULE_DEFS: ScheduleDefinition[] = [
  ...buildSourceScrapeScheduleSources(registeredSources).map((source) => ({
    queue: scrapeQueue,
    name: QUEUES.SOURCE_SCRAPE,
    data: source.data,
    pattern: source.pattern,
    tz: source.tz,
    jobId: source.jobId,
  })),
  ...buildDetailScheduleDefinitions(
    buildDetailScheduleSources(registeredSources),
    { crawl: crawlQueue, extract: extractQueue },
    CRITICAL_JOB_OPTIONS,
  ),
  // Pipeline jobs are staggered to minimise concurrent listing mutations.
  // Row-level locking (processingLockedAt) provides defence-in-depth if
  // schedules slip, but by design these windows should not overlap:
  //
  //   00:00  rawpage-cleanup    (fast, no listing writes)
  //   01:00  vehicle-stats-refresh (Sunday only, no listing writes)
  //   01:30  listing-sync       (read-only index rebuild)
  //   02:00  geocode            (writes lat/lng; ~30-60 min at volume)
  //   03:00  deduplicate        (assigns vehicleId across VIN groups; ~15-30 min)
  //   04:00  vin-enrich         (writes vehicleModelId; runs 4:00 then every
  //                              6 h; avoids the 02:00 and 03:00 windows)
  //   04:30  nhtsa-recalls      (writes to recalls table, no listing rows)
  //   05:00  nhtsa-complaints   (Sunday only; no listing rows)
  //   05:30  model-research     (Sunday only; no listing rows)
  //   06:00  nhtsa-safety-ratings (Sunday only; no listing rows)
  //   06:30  nhtsa-investigations (Sunday only; no listing rows)
  //   07:00  nhtsa-manufacturer-communications (Sunday only; no listing rows)
  { queue: geocodeQueue, name: QUEUES.GEOCODE, data: {}, pattern: '0 2 * * *', tz },
  { queue: deduplicateQueue, name: QUEUES.DEDUPLICATE, data: {}, pattern: '0 3 * * *', tz },
  { queue: vinEnrichQueue, name: QUEUES.VIN_ENRICH, data: {}, pattern: '0 4/6 * * *', tz },
  { queue: nhtsaRecallsQueue, name: QUEUES.NHTSA_RECALLS, data: {}, pattern: '30 4 * * *', tz },
  {
    queue: nhtsaComplaintsQueue,
    name: QUEUES.NHTSA_COMPLAINTS,
    data: {},
    pattern: '0 5 * * 0',
    tz,
  },
  {
    queue: nhtsaSafetyRatingsQueue,
    name: QUEUES.NHTSA_SAFETY_RATINGS,
    data: {},
    pattern: '0 6 * * 0',
    tz,
  },
  {
    queue: nhtsaInvestigationsQueue,
    name: QUEUES.NHTSA_INVESTIGATIONS,
    data: {},
    pattern: '30 6 * * 0',
    tz,
  },
  {
    queue: nhtsaManufacturerCommunicationsQueue,
    name: QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
    data: {},
    pattern: '0 7 * * 0',
    tz,
  },
  {
    queue: vehicleStatsRefreshQueue,
    name: QUEUES.VEHICLE_STATS_REFRESH,
    data: {},
    pattern: '0 1 * * 0',
    tz,
  },
  {
    queue: conversionBrandsSeedQueue,
    name: QUEUES.CONVERSION_BRANDS_SEED,
    data: {},
    pattern: '15 1 * * 0',
    tz,
  },
  {
    queue: nmedaDealersSeedQueue,
    name: QUEUES.NMEDA_DEALERS_SEED,
    data: {},
    pattern: '20 1 * * 0',
    tz,
  },
  { queue: modelResearchQueue, name: QUEUES.MODEL_RESEARCH, data: {}, pattern: '30 5 * * 0', tz },
  {
    queue: listingSyncQueue,
    name: QUEUES.LISTING_SYNC,
    data: {},
    pattern: '30 1 * * *',
    tz,
    options: CRITICAL_JOB_OPTIONS,
  },
  // Single-owner incremental indexer poll (#669) — runs every minute so
  // Postgres writes reach the live search index within a bounded, small
  // delay without any mutation path calling the search service directly.
  {
    queue: listingIndexPollQueue,
    name: QUEUES.LISTING_INDEX_POLL,
    data: {},
    pattern: '* * * * *',
    tz,
    options: CRITICAL_JOB_OPTIONS,
  },
  { queue: rawPageCleanupQueue, name: QUEUES.RAWPAGE_CLEANUP, data: {}, pattern: '0 0 * * *', tz },
  // dealer-enrich runs nightly at 07:00 — after the main pipeline windows.
  // At 50 dealers * 2 requests each = 100 requests, staying within the free-tier budget.
  { queue: dealerEnrichQueue, name: QUEUES.DEALER_ENRICH, data: {}, pattern: '0 7 * * *', tz },
  // fueleconomy-msrp runs weekly on Sunday 07:30 — after dealer-enrich, no listing writes.
  {
    queue: fuelEconomyMsrpQueue,
    name: QUEUES.FUELECONOMY_MSRP,
    data: {},
    pattern: '30 7 * * 0',
    tz,
  },
]

if (shouldRegisterSchedules(runtimeMode)) {
  const scheduleIntents = await readCurrentScheduleIntents(db)
  await reconcileSchedules(applyScheduleIntents(SCHEDULE_DEFS, scheduleIntents), logger)
}

const deprecatedProvider = await readConfigValue('ai.scraper.structure.provider')
if (deprecatedProvider) {
  logger.warn(
    { configuredProvider: deprecatedProvider },
    'ai.scraper.structure.provider config key is set but ignored — provider selection removed; using ollama',
  )
}

logger.info({ runtimeMode }, 'Scraper service started')
