import { describe, expect, it } from 'vitest'
import { MockQueueAdapter, QUEUES } from '@wivwav/queue'
import { SCRAPER_SOURCE_REGISTRY } from '@wivwav/types'
import { buildScheduleDefs, type ScheduleDefQueues } from './schedule-defs.js'
import type { RegisteredSource } from './sources/registry.js'

function makeRow(name: string, id: string) {
  return {
    id,
    name,
    baseUrl: '',
    cronExpression: '0 * * * *',
    timezone: 'America/New_York',
    fingerprintHash: null,
    page1Hash: null,
  }
}

function makeQueues(): ScheduleDefQueues {
  return {
    scrape: new MockQueueAdapter(QUEUES.SOURCE_SCRAPE),
    crawl: new MockQueueAdapter(QUEUES.DETAIL_CRAWL),
    extract: new MockQueueAdapter(QUEUES.DETAIL_EXTRACT),
    geocode: new MockQueueAdapter(QUEUES.GEOCODE),
    deduplicate: new MockQueueAdapter(QUEUES.DEDUPLICATE),
    vinEnrich: new MockQueueAdapter(QUEUES.VIN_ENRICH),
    nhtsaRecalls: new MockQueueAdapter(QUEUES.NHTSA_RECALLS),
    nhtsaComplaints: new MockQueueAdapter(QUEUES.NHTSA_COMPLAINTS),
    nhtsaSafetyRatings: new MockQueueAdapter(QUEUES.NHTSA_SAFETY_RATINGS),
    nhtsaInvestigations: new MockQueueAdapter(QUEUES.NHTSA_INVESTIGATIONS),
    nhtsaManufacturerCommunications: new MockQueueAdapter(
      QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
    ),
    vehicleStatsRefresh: new MockQueueAdapter(QUEUES.VEHICLE_STATS_REFRESH),
    conversionBrandsSeed: new MockQueueAdapter(QUEUES.CONVERSION_BRANDS_SEED),
    nmedaDealersSeed: new MockQueueAdapter(QUEUES.NMEDA_DEALERS_SEED),
    modelResearch: new MockQueueAdapter(QUEUES.MODEL_RESEARCH),
    listingSync: new MockQueueAdapter(QUEUES.LISTING_SYNC),
    listingIndexPoll: new MockQueueAdapter(QUEUES.LISTING_INDEX_POLL),
    rawPageCleanup: new MockQueueAdapter(QUEUES.RAWPAGE_CLEANUP),
    dealerEnrich: new MockQueueAdapter(QUEUES.DEALER_ENRICH),
    fuelEconomyMsrp: new MockQueueAdapter(QUEUES.FUELECONOMY_MSRP),
  }
}

// The full set of queues buildScheduleDefs registers on startup (originally
// apps/scraper/src/index.ts's SCHEDULE_DEFS, per #968's issue body):
// SOURCE_SCRAPE/DETAIL_CRAWL/DETAIL_EXTRACT plus the 13 direct-DB-backed
// queues. Pinned here — built directly from the shared QUEUES constants, not
// string literals — so a future regression in buildScheduleDefs is caught
// by CI instead of silently dropping a schedule.
const EXPECTED_SCHEDULED_QUEUE_NAMES = [
  QUEUES.SOURCE_SCRAPE,
  QUEUES.DETAIL_CRAWL,
  QUEUES.DETAIL_EXTRACT,
  QUEUES.GEOCODE,
  QUEUES.DEDUPLICATE,
  QUEUES.VEHICLE_STATS_REFRESH,
  QUEUES.CONVERSION_BRANDS_SEED,
  QUEUES.NMEDA_DEALERS_SEED,
  QUEUES.LISTING_SYNC,
  QUEUES.LISTING_INDEX_POLL,
  QUEUES.NHTSA_RECALLS,
  QUEUES.NHTSA_COMPLAINTS,
  QUEUES.NHTSA_SAFETY_RATINGS,
  QUEUES.NHTSA_INVESTIGATIONS,
  QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
  QUEUES.VIN_ENRICH,
  QUEUES.MODEL_RESEARCH,
  QUEUES.FUELECONOMY_MSRP,
  QUEUES.DEALER_ENRICH,
  QUEUES.RAWPAGE_CLEANUP,
].sort()

describe('buildScheduleDefs (#968)', () => {
  it('registers the full queue set apps/api schedules on startup', () => {
    const sources: RegisteredSource[] = SCRAPER_SOURCE_REGISTRY.map((definition) => ({
      definition,
      row: makeRow(definition.name, definition.key),
    }))

    const defs = buildScheduleDefs(sources, makeQueues(), 'America/New_York')

    const uniqueNames = [...new Set(defs.map((definition) => definition.name))].sort()
    expect(uniqueNames).toEqual(EXPECTED_SCHEDULED_QUEUE_NAMES)
  })

  it('produces at least one SOURCE_SCRAPE definition per registered source', () => {
    const sources: RegisteredSource[] = SCRAPER_SOURCE_REGISTRY.map((definition) => ({
      definition,
      row: makeRow(definition.name, definition.key),
    }))

    const defs = buildScheduleDefs(sources, makeQueues(), 'America/New_York')

    const sourceScrapeDefs = defs.filter((definition) => definition.name === QUEUES.SOURCE_SCRAPE)
    expect(sourceScrapeDefs).toHaveLength(sources.length)
  })
})
