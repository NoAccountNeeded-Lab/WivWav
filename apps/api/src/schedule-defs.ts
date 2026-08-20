import { CRITICAL_JOB_OPTIONS, QUEUES, type QueueAdapter } from '@wivwav/queue'
import { buildDetailScheduleDefinitions, type ScheduleDefinition } from './schedule-registration.js'
import {
  buildDetailScheduleSources,
  buildSourceScrapeScheduleSources,
  type RegisteredSource,
} from './sources/registry.js'

export interface ScheduleDefQueues {
  scrape: QueueAdapter
  crawl: QueueAdapter
  extract: QueueAdapter
  geocode: QueueAdapter
  deduplicate: QueueAdapter
  vinEnrich: QueueAdapter
  nhtsaRecalls: QueueAdapter
  nhtsaComplaints: QueueAdapter
  nhtsaSafetyRatings: QueueAdapter
  nhtsaInvestigations: QueueAdapter
  nhtsaManufacturerCommunications: QueueAdapter
  vehicleStatsRefresh: QueueAdapter
  conversionBrandsSeed: QueueAdapter
  nmedaDealersSeed: QueueAdapter
  modelResearch: QueueAdapter
  listingSync: QueueAdapter
  listingIndexPoll: QueueAdapter
  rawPageCleanup: QueueAdapter
  dealerEnrich: QueueAdapter
  fuelEconomyMsrp: QueueAdapter
  privateSellerRetention: QueueAdapter
}

/**
 * Relocated from apps/scraper/src/index.ts's SCHEDULE_DEFS — every queue
 * the standalone scraper daemon used to schedule on startup, moved so
 * apps/api registers the same set (#968). #970 deleted the scraper daemon,
 * so this is now the sole source of truth; schedule-defs.test.ts pins the
 * queue-name set this builds so a future regression fails CI instead of
 * silently dropping a schedule.
 *
 * See the git history of apps/scraper/src/index.ts (pre-#970) for the
 * staggering rationale behind each pipeline job's cron pattern.
 */
export function buildScheduleDefs(
  registeredSources: readonly RegisteredSource[],
  queues: ScheduleDefQueues,
  tz: string,
): ScheduleDefinition[] {
  return [
    ...buildSourceScrapeScheduleSources(registeredSources).map((source) => ({
      queue: queues.scrape,
      name: QUEUES.SOURCE_SCRAPE,
      data: source.data,
      pattern: source.pattern,
      tz: source.tz,
      jobId: source.jobId,
    })),
    ...buildDetailScheduleDefinitions(
      buildDetailScheduleSources(registeredSources),
      { crawl: queues.crawl, extract: queues.extract },
      CRITICAL_JOB_OPTIONS,
    ),
    { queue: queues.geocode, name: QUEUES.GEOCODE, data: {}, pattern: '0 2 * * *', tz },
    { queue: queues.deduplicate, name: QUEUES.DEDUPLICATE, data: {}, pattern: '0 3 * * *', tz },
    { queue: queues.vinEnrich, name: QUEUES.VIN_ENRICH, data: {}, pattern: '0 4/6 * * *', tz },
    {
      queue: queues.nhtsaRecalls,
      name: QUEUES.NHTSA_RECALLS,
      data: {},
      pattern: '30 4 * * *',
      tz,
    },
    {
      queue: queues.nhtsaComplaints,
      name: QUEUES.NHTSA_COMPLAINTS,
      data: {},
      pattern: '0 5 * * 0',
      tz,
    },
    {
      queue: queues.nhtsaSafetyRatings,
      name: QUEUES.NHTSA_SAFETY_RATINGS,
      data: {},
      pattern: '0 6 * * 0',
      tz,
    },
    {
      queue: queues.nhtsaInvestigations,
      name: QUEUES.NHTSA_INVESTIGATIONS,
      data: {},
      pattern: '30 6 * * 0',
      tz,
    },
    {
      queue: queues.nhtsaManufacturerCommunications,
      name: QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
      data: {},
      pattern: '0 7 * * 0',
      tz,
    },
    {
      queue: queues.vehicleStatsRefresh,
      name: QUEUES.VEHICLE_STATS_REFRESH,
      data: {},
      pattern: '0 1 * * 0',
      tz,
    },
    {
      queue: queues.conversionBrandsSeed,
      name: QUEUES.CONVERSION_BRANDS_SEED,
      data: {},
      pattern: '15 1 * * 0',
      tz,
    },
    {
      queue: queues.nmedaDealersSeed,
      name: QUEUES.NMEDA_DEALERS_SEED,
      data: {},
      pattern: '20 1 * * 0',
      tz,
    },
    {
      queue: queues.modelResearch,
      name: QUEUES.MODEL_RESEARCH,
      data: {},
      pattern: '30 5 * * 0',
      tz,
    },
    {
      queue: queues.listingSync,
      name: QUEUES.LISTING_SYNC,
      data: {},
      pattern: '30 1 * * *',
      tz,
      options: CRITICAL_JOB_OPTIONS,
    },
    {
      queue: queues.listingIndexPoll,
      name: QUEUES.LISTING_INDEX_POLL,
      data: {},
      pattern: '* * * * *',
      tz,
      options: CRITICAL_JOB_OPTIONS,
    },
    {
      queue: queues.rawPageCleanup,
      name: QUEUES.RAWPAGE_CLEANUP,
      data: {},
      pattern: '0 0 * * *',
      tz,
    },
    {
      queue: queues.dealerEnrich,
      name: QUEUES.DEALER_ENRICH,
      data: {},
      pattern: '0 7 * * *',
      tz,
    },
    // #817 private-seller retention sweep: anonymizes gone private-seller
    // listings past the retention window (clears sensitive fields, deletes
    // their raw-page evidence and image references, removes them from
    // search) — see apps/api/src/services/private-seller-retention.ts.
    {
      queue: queues.privateSellerRetention,
      name: QUEUES.PRIVATE_SELLER_RETENTION,
      data: {},
      pattern: '15 0 * * *',
      tz,
    },
    {
      queue: queues.fuelEconomyMsrp,
      name: QUEUES.FUELECONOMY_MSRP,
      data: {},
      pattern: '30 7 * * 0',
      tz,
    },
  ]
}
