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

import { Meilisearch } from 'meilisearch'
import { Redis } from 'ioredis'
import { RedisCacheService } from './services/cache/index.js'
import { getDb, readCurrentScheduleIntents } from '@wivwav/db'
import { BullMQQueueFactory, QUEUES } from '@wivwav/queue'
import { loadConfig } from './config.js'
import { buildApp } from './app.js'
import { configureListingsIndex, ListingSearchService } from './services/listing-search.js'
import { ListingFacetsService } from './services/listing-facets.js'
import { MeilisearchService } from './services/search/index.js'
import { applyScheduleIntents, reconcileSchedules } from './schedule-registration.js'
import { registerSources } from './sources/registry.js'
import { buildScheduleDefs } from './schedule-defs.js'
import { runGeocodeJob } from './jobs/geocode.js'
import { runDeduplicateJob } from './jobs/deduplicate.js'
import { runVehicleStatsRefreshJob } from './jobs/vehicle-stats-refresh.js'
import { runConversionBrandsSeedJob } from './sources/conversion-brands.js'
import { runNmedaDealersSeedJob } from './sources/nmeda-dealers.js'
import { runMeilisearchSyncJob } from './jobs/meilisearch-sync.js'
import { runSearchIndexerPollJob } from './jobs/search-indexer-poll.js'
import { runListingResolveJob, type ListingResolveJobData } from './jobs/listing-resolve.js'
import { runRawPageCleanupJob } from './jobs/rawpage-cleanup.js'
import {
  runSemanticImageAnalyzeJob,
  type SemanticImageAnalyzeJobData,
} from './jobs/semantic-image-analyze.js'
import { withSentryCapture } from './lib/capture-job-error.js'
import { withJobRunTracking } from './lib/job-run-tracking.js'
import { PrismaJobRunRepository } from './lib/job-run-repository.js'

const config = loadConfig()
if (!config.CONFIG_ENCRYPTION_SECRET) {
  console.error('CONFIG_ENCRYPTION_SECRET is required to start the API. Set it to a 64-character hex string (32 bytes).')
  process.exit(1)
}
const db = getDb()
const meili = new Meilisearch({ host: config.MEILISEARCH_HOST, apiKey: config.MEILISEARCH_API_KEY })
const redis = new Redis(config.VALKEY_URL, { lazyConnect: true, enableOfflineQueue: false })
const cache = new RedisCacheService(redis)
const searchService = new MeilisearchService(meili)
const search = new ListingSearchService(searchService)
const facets = new ListingFacetsService(searchService, cache)
const queueFactory = new BullMQQueueFactory()
const app = await buildApp(config, db, meili, cache, search, facets, queueFactory, redis)

// #933 lineage backbone: one JobRun row per job execution, across every job
// type registered below — see lib/job-run-tracking.ts.
const jobRuns = new PrismaJobRunRepository(db)

let shutdownPromise: Promise<void> | undefined

async function closeCache(): Promise<void> {
  if (redis.status === 'ready') {
    await redis.quit()
    return
  }

  redis.disconnect()
}

function shutdown(signal: NodeJS.Signals): Promise<void> {
  shutdownPromise ??= (async () => {
    app.log.info(`[shutdown] ${signal} received, closing`)

    try {
      await app.close()
      await queueFactory.close()
      await closeCache()
      await db.$disconnect()
      app.log.info('[shutdown] complete')
      if (isSentryEnabled) {
        await Sentry.flush(2000)
      }
      process.exit(0)
    } catch (err) {
      app.log.error(err, '[shutdown] failed')
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

// --- Scraper schedule registration (#968, apps/scraper deleted by #970) ---
// Registers the repeatable schedules apps/scraper/src/index.ts used to
// register before #970 deleted the standalone scraper daemon and made
// apps/api the sole process reconciling them. Wrapped in try/catch because
// apps/api is the primary user-facing HTTP service: a transient DB/Redis
// error here must not stop it from binding its port and serving requests.
//
// Runs unconditionally on every boot — there is no singleton/runtime-mode
// gate. registerSources upserts (cheap) and reconcileSchedules is
// idempotent, so a rolling deploy or restart re-running this is safe, just
// not free; revisit if apps/api is ever run with more than a couple of
// replicas.
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
const rawPageCleanupQueue = queueFactory.createQueue(QUEUES.RAWPAGE_CLEANUP)
const dealerEnrichQueue = queueFactory.createQueue(QUEUES.DEALER_ENRICH)
const fuelEconomyMsrpQueue = queueFactory.createQueue(QUEUES.FUELECONOMY_MSRP)
// No local binding: resolution jobs are enqueued from the internal-scraper
// and internal-http-enrich routes, not from this startup script. Registering
// it here still makes the BullMQ Queue instance visible to shutdown()'s close().
queueFactory.createQueue(QUEUES.LISTING_RESOLVE)
// No local binding: nothing in this process enqueues onto this queue — only
// the #798 backfill script (jobs/semantic-image-analyze-backfill.ts, a
// separate process/factory) does. Registering it here still makes the
// BullMQ Queue instance visible to shutdown()'s close().
queueFactory.createQueue(QUEUES.IMAGE_SEMANTIC_ANALYZE)

// --- Direct-DB job workers (#969) ---
// Registers the workers apps/scraper/src/index.ts's registerWorkers() used
// to register from its own copy of these job files, before #970 deleted the
// standalone scraper daemon.
function registerWorkers(): void {
  queueFactory.createWorker(
    QUEUES.GEOCODE,
    withSentryCapture(
      QUEUES.GEOCODE,
      withJobRunTracking(QUEUES.GEOCODE, jobRuns, (_data: unknown, context) =>
        runGeocodeJob(context),
      ),
    ),
    { lockDuration: 120_000, logger: app.log },
  )
  queueFactory.createWorker(
    QUEUES.DEDUPLICATE,
    withSentryCapture(
      QUEUES.DEDUPLICATE,
      withJobRunTracking(QUEUES.DEDUPLICATE, jobRuns, (_data: unknown, context) =>
        runDeduplicateJob(context),
      ),
    ),
    { lockDuration: 120_000, logger: app.log },
  )
  queueFactory.createWorker(
    QUEUES.VEHICLE_STATS_REFRESH,
    withSentryCapture(
      QUEUES.VEHICLE_STATS_REFRESH,
      withJobRunTracking(QUEUES.VEHICLE_STATS_REFRESH, jobRuns, (_data: unknown, context) =>
        runVehicleStatsRefreshJob(context),
      ),
    ),
    { lockDuration: 60_000, logger: app.log },
  )
  queueFactory.createWorker(
    QUEUES.CONVERSION_BRANDS_SEED,
    withSentryCapture(
      QUEUES.CONVERSION_BRANDS_SEED,
      withJobRunTracking(QUEUES.CONVERSION_BRANDS_SEED, jobRuns, (_data: unknown, context) =>
        runConversionBrandsSeedJob(context),
      ),
    ),
    { lockDuration: 60_000, logger: app.log },
  )
  queueFactory.createWorker(
    QUEUES.NMEDA_DEALERS_SEED,
    withSentryCapture(
      QUEUES.NMEDA_DEALERS_SEED,
      withJobRunTracking(QUEUES.NMEDA_DEALERS_SEED, jobRuns, (_data: unknown, context) =>
        runNmedaDealersSeedJob(context),
      ),
    ),
    { lockDuration: 60_000, logger: app.log },
  )
  queueFactory.createWorker(
    QUEUES.LISTING_SYNC,
    withSentryCapture(
      QUEUES.LISTING_SYNC,
      withJobRunTracking(QUEUES.LISTING_SYNC, jobRuns, (_data: unknown, context) =>
        runMeilisearchSyncJob(context),
      ),
    ),
    { lockDuration: 300_000, logger: app.log },
  )
  queueFactory.createWorker(
    QUEUES.LISTING_INDEX_POLL,
    withSentryCapture(
      QUEUES.LISTING_INDEX_POLL,
      withJobRunTracking(QUEUES.LISTING_INDEX_POLL, jobRuns, (_data: unknown, context) =>
        runSearchIndexerPollJob(context),
      ),
    ),
    { lockDuration: 120_000, logger: app.log },
  )
  queueFactory.createWorker<ListingResolveJobData>(
    QUEUES.LISTING_RESOLVE,
    withSentryCapture<ListingResolveJobData>(
      QUEUES.LISTING_RESOLVE,
      withJobRunTracking<ListingResolveJobData>(QUEUES.LISTING_RESOLVE, jobRuns, (data, context) =>
        runListingResolveJob(data, context),
      ),
    ),
    { lockDuration: 120_000, logger: app.log },
  )
  queueFactory.createWorker(
    QUEUES.RAWPAGE_CLEANUP,
    withSentryCapture(
      QUEUES.RAWPAGE_CLEANUP,
      withJobRunTracking(QUEUES.RAWPAGE_CLEANUP, jobRuns, (_data: unknown, context) =>
        runRawPageCleanupJob(context),
      ),
    ),
    { lockDuration: 120_000, logger: app.log },
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
    { lockDuration: 60_000, logger: app.log },
  )
}

registerWorkers()

try {
  const registeredSources = await registerSources(db)

  const schedulerSource = registeredSources[0]
  if (!schedulerSource) {
    throw new Error('No scraper sources are registered')
  }
  const scheduleTz = schedulerSource.row.timezone

  const SCHEDULE_DEFS = buildScheduleDefs(
    registeredSources,
    {
      scrape: scrapeQueue,
      crawl: crawlQueue,
      extract: extractQueue,
      geocode: geocodeQueue,
      deduplicate: deduplicateQueue,
      vinEnrich: vinEnrichQueue,
      nhtsaRecalls: nhtsaRecallsQueue,
      nhtsaComplaints: nhtsaComplaintsQueue,
      nhtsaSafetyRatings: nhtsaSafetyRatingsQueue,
      nhtsaInvestigations: nhtsaInvestigationsQueue,
      nhtsaManufacturerCommunications: nhtsaManufacturerCommunicationsQueue,
      vehicleStatsRefresh: vehicleStatsRefreshQueue,
      conversionBrandsSeed: conversionBrandsSeedQueue,
      nmedaDealersSeed: nmedaDealersSeedQueue,
      modelResearch: modelResearchQueue,
      listingSync: listingSyncQueue,
      listingIndexPoll: listingIndexPollQueue,
      rawPageCleanup: rawPageCleanupQueue,
      dealerEnrich: dealerEnrichQueue,
      fuelEconomyMsrp: fuelEconomyMsrpQueue,
    },
    scheduleTz,
  )

  const scheduleIntents = await readCurrentScheduleIntents(db)
  await reconcileSchedules(applyScheduleIntents(SCHEDULE_DEFS, scheduleIntents), app.log)
  app.log.info({ scheduleCount: SCHEDULE_DEFS.length }, '[schedules] Reconciled on startup')
} catch (err) {
  app.log.error(err, '[schedules] Reconciliation skipped this boot; will retry on next restart')
}

// Apply index settings before accepting traffic so filters/facets work on the
// first request. Idempotent — safe on every restart, including a fresh container.
try {
  await configureListingsIndex(meili, config.MEILISEARCH_INDEX_NAME)
  app.log.info({ indexName: config.MEILISEARCH_INDEX_NAME }, '[search] Index settings applied')
} catch (err) {
  const reason = err instanceof Error ? `: ${err.message}` : ''
  app.log.warn(`[search] Index config skipped; Meilisearch may not be available${reason}`)
}

try {
  await app.listen({ port: config.PORT, host: config.HOST })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// API startup never rebuilds or clears the search index (#669) — the scraper's
// single-owner indexer poller and scheduled full-rebuild job are the only
// writers to the listings projection.
