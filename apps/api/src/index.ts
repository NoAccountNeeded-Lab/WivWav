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

// --- Scraper schedule registration (#968) ---
// Registers the same repeatable schedules apps/scraper/src/index.ts
// registers from its own copy of this logic — see the note atop
// schedule-registration.ts for why both processes reconciling concurrently
// during the migration window is safe.
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
const rawPageCleanupQueue = queueFactory.createQueue(QUEUES.RAWPAGE_CLEANUP)
const dealerEnrichQueue = queueFactory.createQueue(QUEUES.DEALER_ENRICH)
const fuelEconomyMsrpQueue = queueFactory.createQueue(QUEUES.FUELECONOMY_MSRP)

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
