import { QUEUES } from '@wivwav/queue'

/**
 * The queues this daemon never registers an in-process worker for. As of the
 * #953 cutover (the three Chromium/DOM jobs) and the #964 cutover (the 9
 * outbound-HTTP-only enrichment jobs), apps/api's worker gateway is their
 * sole consumer — jobs are dispatched to apps/worker (the laptop/Mac Mini
 * job-runner fleet) instead. `index.ts`'s `registerWorkers()` intentionally
 * contains no `queueFactory.createWorker` call for any of these.
 *
 * `reconcileSchedules` still adds repeatable jobs to these queue names from
 * this process (see `index.ts`'s `SCHEDULE_DEFS`) — `queue.add` is
 * processor-agnostic, so scheduling and worker registration are independent
 * concerns and this exclusion does not affect scheduling.
 *
 * Exported as a named, tested list (rather than left as inline literals in
 * index.ts) because index.ts itself can't be unit tested: it's a top-level
 * script that opens a live database connection as a side effect of import.
 */
export const GATEWAY_OWNED_QUEUES = [
  QUEUES.SOURCE_SCRAPE,
  QUEUES.DETAIL_CRAWL,
  QUEUES.DETAIL_EXTRACT,
  QUEUES.NHTSA_RECALLS,
  QUEUES.NHTSA_COMPLAINTS,
  QUEUES.NHTSA_SAFETY_RATINGS,
  QUEUES.NHTSA_INVESTIGATIONS,
  QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
  QUEUES.VIN_ENRICH,
  QUEUES.MODEL_RESEARCH,
  QUEUES.FUELECONOMY_MSRP,
  QUEUES.DEALER_ENRICH,
] as const

/**
 * Every queue `index.ts`'s `registerWorkers()` creates an in-process worker
 * for. Kept in sync with `registerWorkers()` by hand — there is no single
 * data-driven registration loop there because each queue's handler and
 * `lockDuration` differ. The worker-registration test below asserts this
 * list stays disjoint from `GATEWAY_OWNED_QUEUES`.
 */
export const SCRAPER_WORKER_QUEUES = [
  QUEUES.GEOCODE,
  QUEUES.DEDUPLICATE,
  QUEUES.VEHICLE_STATS_REFRESH,
  QUEUES.CONVERSION_BRANDS_SEED,
  QUEUES.NMEDA_DEALERS_SEED,
  QUEUES.LISTING_SYNC,
  QUEUES.LISTING_INDEX_POLL,
  QUEUES.LISTING_RESOLVE,
  QUEUES.RAWPAGE_CLEANUP,
  QUEUES.IMAGE_SEMANTIC_ANALYZE,
] as const
