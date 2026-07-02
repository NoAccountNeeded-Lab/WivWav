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

import { getDb } from '@wivwav/db'
import { createLogger } from '@wivwav/logger'
import { BullMQQueueFactory, CRITICAL_JOB_OPTIONS, LISTING_SYNC_REBUILD_JOB_ID, QUEUES } from '@wivwav/queue'
import type { JobOptions, QueueAdapter } from '@wivwav/queue'
import { ScraperEngine } from './engine/scraper-engine.js'
import { BlvdAdapter } from './sources/blvd.js'
import { MobilityWorksAdapter } from './sources/mobilityworks.js'
import { OllamaProvider } from './ai/ollama-provider.js'
import { StructureDetector } from './ai/structure-detector.js'
import { resolveOllamaModel } from './ai/ollama-config.js'
import type { CompletionProvider } from './ai/completion-provider.js'
import {
  PrismaScraperRunRepository,
  PrismaSourceRepository,
  PrismaListingRepository,
} from './infrastructure/prisma-repositories.js'
import { runDetailCrawlJob } from './jobs/detail-crawl.js'
import { runDetailExtractJob } from './jobs/detail-extract.js'
import { runGeocodeJob } from './jobs/geocode.js'
import { runDeduplicateJob } from './jobs/deduplicate.js'
import { runVinEnrichJob } from './jobs/vin-enrich.js'
import { runNhtsaRecallsJob, type NhtsaRecallsJobData } from './jobs/nhtsa-recalls.js'
import { runNhtsaComplaintsJob, type NhtsaComplaintsJobData } from './jobs/nhtsa-complaints.js'
import { runNhtsaSafetyRatingsJob, type NhtsaSafetyRatingsJobData } from './jobs/nhtsa-safety-ratings.js'
import { runNhtsaInvestigationsJob, type NhtsaInvestigationsJobData } from './jobs/nhtsa-investigations.js'
import {
  runNhtsaManufacturerCommunicationsJob,
  type NhtsaManufacturerCommunicationsJobData,
} from './jobs/nhtsa-manufacturer-communications.js'
import { runVehicleStatsRefreshJob } from './jobs/vehicle-stats-refresh.js'
import { runConversionBrandsSeedJob } from './sources/conversion-brands.js'
import { runNmedaDealersSeedJob } from './sources/nmeda-dealers.js'
import { runModelResearchJob } from './jobs/model-research.js'
import { runMeilisearchSyncJob } from './jobs/meilisearch-sync.js'
import { runRawPageCleanupJob } from './jobs/rawpage-cleanup.js'
import { runDealerEnrichJob } from './jobs/dealer-enrich.js'
import { runFuelEconomyMsrpJob, type FuelEconomyMsrpJobData } from './jobs/fueleconomy-msrp.js'
import { withSentryCapture } from './lib/capture-job-error.js'
import { PlaywrightBrowserService } from './browser/index.js'
import type { JobContext } from '@wivwav/queue'
import { syncListings } from '@wivwav/search'
import { getMeiliClient } from './lib/meili.js'

const db = getDb()
const logger = createLogger({
  service: 'scraper',
  env: process.env['NODE_ENV'] ?? 'development',
})

// Referenced by onListingsGone below via closure; listingSyncQueue is
// initialized further down in "Queue setup", before any job runs.
async function syncGoneListings(ids: string[]): Promise<void> {
  try {
    await syncListings(ids, db, getMeiliClient())
  } catch (syncErr) {
    logger.error({ err: syncErr, count: ids.length }, '[engine] Meilisearch sync failed for newly-gone listings — deferring to listing-sync queue')
    try {
      await listingSyncQueue.add({}, { ...CRITICAL_JOB_OPTIONS, jobId: LISTING_SYNC_REBUILD_JOB_ID })
    } catch (enqueueErr) {
      logger.error({ err: enqueueErr }, '[engine] Failed to enqueue listing-sync job')
    }
  }
}

const engine = new ScraperEngine({
  runs: new PrismaScraperRunRepository(db),
  sources: new PrismaSourceRepository(db),
  listings: new PrismaListingRepository(db),
  onListingsGone: syncGoneListings,
})

const browserService = new PlaywrightBrowserService()

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

async function buildOllamaProvider(): Promise<OllamaProvider> {
  const model = await resolveOllamaModel(db)
  return new OllamaProvider({
    baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
    model: model ?? process.env['OLLAMA_MODEL'] ?? 'llama3.2:3b',
  })
}

async function runSourceWithProvider(
  sourceId: string,
  provider: CompletionProvider | null,
  context?: JobContext,
): Promise<boolean> {
  return engine.runSource(sourceId, context, provider ? new StructureDetector(provider) : null)
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
// Adapters MUST be registered with the engine before the SOURCE_SCRAPE worker
// is created below. createWorker starts consuming immediately, so any repeatable
// source-scrape job that is already due (or stalled from a prior run) would call
// engine.runSource() before registration and fail with "No adapter registered".

const blvdSource = await db.source.upsert({
  where: { name: 'BLVD.com' },
  update: {},
  create: {
    name: 'BLVD.com',
    baseUrl: 'https://www.blvd.com',
    cronExpression: '0 */6 * * *',
    timezone: 'America/New_York',
  },
})

engine.register(
  new BlvdAdapter(blvdSource.fingerprintHash, { previousPage1Hash: blvdSource.page1Hash, browserService }),
  blvdSource.id,
)

const mwSource = await db.source.upsert({
  where: { name: 'MobilityWorks' },
  update: {},
  create: {
    name: 'MobilityWorks',
    baseUrl: 'https://www.mobilityworks.com',
    cronExpression: '0 */8 * * *',
    timezone: 'America/New_York',
  },
})

engine.register(
  new MobilityWorksAdapter(mwSource.fingerprintHash, { previousPage1Hash: mwSource.page1Hash, browserService }),
  mwSource.id,
)

// Workers — each processor is wrapped with withSentryCapture so that job
// failures are reported to Sentry before BullMQ marks them as failed.
// Explicit type parameters on withSentryCapture preserve the same type safety
// as the original createWorker<T> call sites.
queueFactory.createWorker<{ sourceId: string }>(
  QUEUES.SOURCE_SCRAPE,
  withSentryCapture<{ sourceId: string }>(QUEUES.SOURCE_SCRAPE, async ({ sourceId }, context) => {
    const ollamaProvider = await buildOllamaProvider()
    const aiAvailable = await ollamaProvider.isAvailable()
    if (!aiAvailable) {
      context?.logger?.warn('Ollama unavailable — running without AI-assisted remapping')
      await context?.log('Ollama unavailable — running without AI-assisted remapping')
    }
    const listingsChanged = await runSourceWithProvider(sourceId, aiAvailable ? ollamaProvider : null, context)
    // A changed source observation can move an eligible listing back to
    // pending. Rebuild promptly so its stale document does not remain public
    // until the nightly reconciliation.
    if (listingsChanged) {
      await listingSyncQueue.add({}, { ...CRITICAL_JOB_OPTIONS, jobId: LISTING_SYNC_REBUILD_JOB_ID })
      await listingResolveQueue.add({ sourceId }, CRITICAL_JOB_OPTIONS)
    }
  }),
  { lockDuration: 300_000, logger },
)
queueFactory.createWorker<{ sourceId: string }>(
  QUEUES.DETAIL_CRAWL,
  withSentryCapture<{ sourceId: string }>(QUEUES.DETAIL_CRAWL, ({ sourceId }, context) =>
    runDetailCrawlJob(sourceId, context, listingSyncQueue, browserService),
  ),
  { lockDuration: 120_000, logger },
)
queueFactory.createWorker<{ sourceId: string }>(
  QUEUES.DETAIL_EXTRACT,
  withSentryCapture<{ sourceId: string }>(QUEUES.DETAIL_EXTRACT, ({ sourceId }, context) =>
    runDetailExtractJob(sourceId, context, browserService, listingResolveQueue),
  ),
  { lockDuration: 60_000, logger },
)
queueFactory.createWorker(
  QUEUES.GEOCODE,
  withSentryCapture(QUEUES.GEOCODE, (_data: unknown, context) => runGeocodeJob(context, listingSyncQueue)),
  { lockDuration: 120_000, logger },
)
queueFactory.createWorker(
  QUEUES.DEDUPLICATE,
  withSentryCapture(QUEUES.DEDUPLICATE, (_data: unknown, context) => runDeduplicateJob(context)),
  { lockDuration: 120_000, logger },
)
queueFactory.createWorker(
  QUEUES.VIN_ENRICH,
  withSentryCapture(QUEUES.VIN_ENRICH, (_data: unknown, context) => runVinEnrichJob(context, listingSyncQueue)),
  { lockDuration: 300_000, logger },
)
queueFactory.createWorker(
  QUEUES.NHTSA_RECALLS,
  withSentryCapture(QUEUES.NHTSA_RECALLS, (data: NhtsaRecallsJobData, context) =>
    runNhtsaRecallsJob(context, data),
  ),
  { lockDuration: 300_000, logger },
)
queueFactory.createWorker(
  QUEUES.NHTSA_COMPLAINTS,
  withSentryCapture(QUEUES.NHTSA_COMPLAINTS, (data: NhtsaComplaintsJobData, context) =>
    runNhtsaComplaintsJob(context, data),
  ),
  { lockDuration: 600_000, logger },
)
queueFactory.createWorker(
  QUEUES.NHTSA_SAFETY_RATINGS,
  withSentryCapture(QUEUES.NHTSA_SAFETY_RATINGS, (data: NhtsaSafetyRatingsJobData, context) =>
    runNhtsaSafetyRatingsJob(context, data),
  ),
  { lockDuration: 600_000, logger },
)
queueFactory.createWorker(
  QUEUES.NHTSA_INVESTIGATIONS,
  withSentryCapture(QUEUES.NHTSA_INVESTIGATIONS, (data: NhtsaInvestigationsJobData, context) =>
    runNhtsaInvestigationsJob(context, data),
  ),
  { lockDuration: 600_000, logger },
)
queueFactory.createWorker(
  QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
  withSentryCapture(QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS, (data: NhtsaManufacturerCommunicationsJobData, context) =>
    runNhtsaManufacturerCommunicationsJob(context, data),
  ),
  { lockDuration: 600_000, logger },
)
queueFactory.createWorker(
  QUEUES.VEHICLE_STATS_REFRESH,
  withSentryCapture(QUEUES.VEHICLE_STATS_REFRESH, (_data: unknown, context) =>
    runVehicleStatsRefreshJob(context),
  ),
  { lockDuration: 60_000, logger },
)
queueFactory.createWorker(
  QUEUES.CONVERSION_BRANDS_SEED,
  withSentryCapture(QUEUES.CONVERSION_BRANDS_SEED, (_data: unknown, context) =>
    runConversionBrandsSeedJob(context),
  ),
  { lockDuration: 60_000, logger },
)
queueFactory.createWorker(
  QUEUES.NMEDA_DEALERS_SEED,
  withSentryCapture(QUEUES.NMEDA_DEALERS_SEED, (_data: unknown, context) =>
    runNmedaDealersSeedJob(context),
  ),
  { lockDuration: 60_000, logger },
)
queueFactory.createWorker(
  QUEUES.MODEL_RESEARCH,
  withSentryCapture(QUEUES.MODEL_RESEARCH, (_data: unknown, context) =>
    runModelResearchJob(context),
  ),
  { lockDuration: 600_000, logger },
)
queueFactory.createWorker(
  QUEUES.LISTING_SYNC,
  withSentryCapture(QUEUES.LISTING_SYNC, (_data: unknown, context) =>
    runMeilisearchSyncJob(context),
  ),
  { lockDuration: 300_000, logger },
)
queueFactory.createWorker(
  QUEUES.RAWPAGE_CLEANUP,
  withSentryCapture(QUEUES.RAWPAGE_CLEANUP, (_data: unknown, context) =>
    runRawPageCleanupJob(context),
  ),
  { lockDuration: 120_000, logger },
)
queueFactory.createWorker(
  QUEUES.DEALER_ENRICH,
  withSentryCapture(QUEUES.DEALER_ENRICH, (_data: unknown, context) =>
    runDealerEnrichJob(context),
  ),
  { lockDuration: 300_000, logger },
)
queueFactory.createWorker(
  QUEUES.FUELECONOMY_MSRP,
  withSentryCapture(QUEUES.FUELECONOMY_MSRP, (data: FuelEconomyMsrpJobData, context) =>
    runFuelEconomyMsrpJob(context, data),
  ),
  { lockDuration: 600_000, logger },
)

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
const nhtsaManufacturerCommunicationsQueue = queueFactory.createQueue(QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS)
const vehicleStatsRefreshQueue = queueFactory.createQueue(QUEUES.VEHICLE_STATS_REFRESH)
const conversionBrandsSeedQueue = queueFactory.createQueue(QUEUES.CONVERSION_BRANDS_SEED)
const nmedaDealersSeedQueue = queueFactory.createQueue(QUEUES.NMEDA_DEALERS_SEED)
const modelResearchQueue = queueFactory.createQueue(QUEUES.MODEL_RESEARCH)
const listingSyncQueue = queueFactory.createQueue(QUEUES.LISTING_SYNC)
const listingResolveQueue = queueFactory.createQueue(QUEUES.LISTING_RESOLVE)
const rawPageCleanupQueue = queueFactory.createQueue(QUEUES.RAWPAGE_CLEANUP)
const dealerEnrichQueue = queueFactory.createQueue(QUEUES.DEALER_ENRICH)
const fuelEconomyMsrpQueue = queueFactory.createQueue(QUEUES.FUELECONOMY_MSRP)

// --- Repeatable schedules ---
// BullMQ/Valkey owns the schedule; no node-cron process needed.
// On startup we only add a schedule if it isn't already in BullMQ, so that
// changes made via the ops UI (/ops/schedules) survive scraper restarts.

interface ScheduleDef {
  queue: QueueAdapter
  name: string
  data: Record<string, unknown>
  pattern: string
  tz: string
  jobId?: string // stable ID used to identify per-source repeatable jobs
  options?: JobOptions
}

const tz = blvdSource.timezone

const SCHEDULE_DEFS: ScheduleDef[] = [
  {
    queue: scrapeQueue,
    name: QUEUES.SOURCE_SCRAPE,
    data: { sourceId: blvdSource.id },
    pattern: blvdSource.cronExpression,
    tz: blvdSource.timezone,
    jobId: 'blvd',
  },
  {
    queue: scrapeQueue,
    name: QUEUES.SOURCE_SCRAPE,
    data: { sourceId: mwSource.id },
    pattern: mwSource.cronExpression,
    tz: mwSource.timezone,
    jobId: 'mw',
  },
  {
    queue: crawlQueue,
    name: QUEUES.DETAIL_CRAWL,
    data: { sourceId: blvdSource.id },
    pattern: '0 * * * *',
    tz,
    jobId: 'blvd-crawl',
    options: CRITICAL_JOB_OPTIONS,
  },
  {
    queue: crawlQueue,
    name: QUEUES.DETAIL_CRAWL,
    data: { sourceId: mwSource.id },
    pattern: '0 * * * *',
    tz: mwSource.timezone,
    jobId: 'mw-crawl',
    options: CRITICAL_JOB_OPTIONS,
  },
  {
    queue: extractQueue,
    name: QUEUES.DETAIL_EXTRACT,
    data: { sourceId: blvdSource.id },
    pattern: '*/5 * * * *',
    tz,
    jobId: 'blvd-extract',
    options: CRITICAL_JOB_OPTIONS,
  },
  {
    queue: extractQueue,
    name: QUEUES.DETAIL_EXTRACT,
    data: { sourceId: mwSource.id },
    pattern: '*/5 * * * *',
    tz: mwSource.timezone,
    jobId: 'mw-extract',
    options: CRITICAL_JOB_OPTIONS,
  },
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
  { queue: conversionBrandsSeedQueue, name: QUEUES.CONVERSION_BRANDS_SEED, data: {}, pattern: '15 1 * * 0', tz },
  { queue: nmedaDealersSeedQueue, name: QUEUES.NMEDA_DEALERS_SEED, data: {}, pattern: '20 1 * * 0', tz },
  { queue: modelResearchQueue, name: QUEUES.MODEL_RESEARCH, data: {}, pattern: '30 5 * * 0', tz },
  { queue: listingSyncQueue, name: QUEUES.LISTING_SYNC, data: {}, pattern: '30 1 * * *', tz, options: CRITICAL_JOB_OPTIONS },
  { queue: rawPageCleanupQueue, name: QUEUES.RAWPAGE_CLEANUP, data: {}, pattern: '0 0 * * *', tz },
  // dealer-enrich runs nightly at 07:00 — after the main pipeline windows.
  // At 50 dealers * 2 requests each = 100 requests, staying within the free-tier budget.
  { queue: dealerEnrichQueue, name: QUEUES.DEALER_ENRICH, data: {}, pattern: '0 7 * * *', tz },
  // fueleconomy-msrp runs weekly on Sunday 07:30 — after dealer-enrich, no listing writes.
  { queue: fuelEconomyMsrpQueue, name: QUEUES.FUELECONOMY_MSRP, data: {}, pattern: '30 7 * * 0', tz },
]

for (const def of SCHEDULE_DEFS) {
  const existing = await def.queue.getRepeatableJobs()
  // BullMQ 5 omits `id` from repeatable metadata, so also fall back to name+pattern.
  const alreadyScheduled = def.jobId
    ? (existing.some((r) => r.id === def.jobId) ||
       existing.some((r) => r.name === def.name && r.pattern === def.pattern))
    : existing.some((r) => r.name === def.name)

  if (!alreadyScheduled) {
    await def.queue.addRepeatable(def.name, def.data, def.pattern, def.tz, def.jobId, def.options)
    logger.info(
      { queue: def.name, jobId: def.jobId, pattern: def.pattern, tz: def.tz },
      'Schedule registered',
    )
  } else {
    logger.debug({ queue: def.name, jobId: def.jobId }, 'Schedule already registered')
  }
}

const deprecatedProvider = await readConfigValue('ai.scraper.structure.provider')
if (deprecatedProvider) {
  logger.warn(
    { configuredProvider: deprecatedProvider },
    'ai.scraper.structure.provider config key is set but ignored — provider selection removed; using ollama',
  )
}

logger.info('Scraper service started')
