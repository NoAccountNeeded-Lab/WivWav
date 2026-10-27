/** Public, non-secret operator settings. Values are integers in the stated units. */
export const OPERATOR_SETTINGS = {
  'detail_crawl.batch_size': { type: 'number', defaultValue: 50, min: 1, max: 500, description: 'Detail pages crawled in one job.', relatedPages: ['/ops/queues', '/ops/sources'] },
  'detail_crawl.rate_limit_ms': { type: 'number', defaultValue: 2000, min: 100, max: 60000, description: 'Delay between detail page requests in milliseconds.', relatedPages: ['/ops/queues', '/ops/sources'] },
  'detail_crawl.stale_days': { type: 'number', defaultValue: 30, min: 1, max: 365, description: 'Age in days before a listing detail is crawled again.', relatedPages: ['/ops/sources'] },
  'detail_extract.batch_size': { type: 'number', defaultValue: 100, min: 1, max: 1000, description: 'Stored detail pages extracted in one job.', relatedPages: ['/ops/queues', '/ops/sources'] },
  'scraper.full_crawl_interval_hours': { type: 'number', defaultValue: 24, min: 1, max: 720, description: 'Hours between full crawls when the first page is unchanged.', relatedPages: ['/ops/schedules', '/ops/sources'] },
  'vin_enrich.batch_size': { type: 'number', defaultValue: 100, min: 1, max: 1000, description: 'Listings claimed per VIN enrichment job.', relatedPages: ['/ops/queues'] },
  'dealer_enrich.max_per_run': { type: 'number', defaultValue: 50, min: 1, max: 50, description: 'Dealers processed in one run; capped by the daily Places API budget.', relatedPages: ['/ops/queues'] },
  'dealer_enrich.stale_days': { type: 'number', defaultValue: 30, min: 1, max: 365, description: 'Age in days before dealer data is refreshed.', relatedPages: ['/ops/queues'] },
  'dealer_enrich.rate_limit_ms': { type: 'number', defaultValue: 200, min: 100, max: 60000, description: 'Delay between Google Places requests in milliseconds.', relatedPages: ['/ops/queues'] },
  'external.nhtsa.rate_limit_ms': { type: 'number', defaultValue: 300, min: 100, max: 60000, description: 'Delay between NHTSA requests in milliseconds.', relatedPages: ['/ops/queues'] },
  'search.indexer.batch_size': { type: 'number', defaultValue: 500, min: 1, max: 5000, description: 'Listings sent to search in one batch.', relatedPages: ['/ops/queues'] },
  'search.indexer.max_batches': { type: 'number', defaultValue: 20, min: 1, max: 200, description: 'Maximum search batches in one poll.', relatedPages: ['/ops/queues'] },
  'retention.raw_page.processed_days': { type: 'number', defaultValue: 7, min: 1, max: 365, description: 'Days to retain processed raw pages.', relatedPages: ['/ops/queues'] },
  'retention.raw_page.unprocessed_days': { type: 'number', defaultValue: 30, min: 1, max: 365, description: 'Days to retain unprocessed raw pages.', relatedPages: ['/ops/queues'] },
  'health.scraper_stale_hours': { type: 'number', defaultValue: 24, min: 1, max: 720, description: 'Hours before scraper health is marked stale; overview severity becomes critical at twice this value.', relatedPages: ['/ops'] },
  'ops.stall_threshold_hours': { type: 'number', defaultValue: 6, min: 1, max: 168, description: 'Hours without progress before a job is considered stalled.', relatedPages: ['/ops/queues', '/ops/sources'] },
} as const

export type OperatorSettingKey = keyof typeof OPERATOR_SETTINGS

export function isOperatorSettingKey(key: string): key is OperatorSettingKey {
  return Object.hasOwn(OPERATOR_SETTINGS, key)
}

/** Invalid, missing, or tombstoned rows use the default; numeric rows are clamped. */
export function resolveOperatorSetting(key: OperatorSettingKey, row: { value: unknown; type: string } | null | undefined): number {
  const definition = OPERATOR_SETTINGS[key]
  if (row?.type !== 'number' || typeof row.value !== 'number' || !Number.isFinite(row.value) || !Number.isInteger(row.value)) {
    return definition.defaultValue
  }
  return Math.min(definition.max, Math.max(definition.min, row.value))
}
