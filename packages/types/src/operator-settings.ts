/** Public, non-secret operator settings. */
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
  'quality.systemic_error_threshold': { type: 'number', defaultValue: 0.2, min: 0.05, max: 0.8, integer: false, description: 'Error fraction that aborts a source scrape as systemically dirty.', relatedPages: ['/ops/sources'] },
  'quality.drift_threshold_pp': { type: 'number', defaultValue: 0.15, min: 0.05, max: 0.5, integer: false, description: 'Allowed error or missing-rate increase above a source baseline, in percentage points.', relatedPages: ['/ops/sources'] },
  'quality.systemic_min_listings': { type: 'number', defaultValue: 5, min: 1, max: 100, description: 'Minimum listings required before the systemic error threshold can abort a scrape.', relatedPages: ['/ops/sources'] },
  'semantic_evidence.min_confidence': { type: 'number', defaultValue: 0.85, min: 0, max: 1, integer: false, description: 'Minimum confidence for semantic image evidence shown on listing details.', relatedPages: ['/ops/settings'] },
  'facets.cache_ttl_s': { type: 'number', defaultValue: 60, min: 0, max: 3600, description: 'Facet response cache lifetime in seconds; zero disables caching.', relatedPages: ['/ops'] },
  'health.latency_ms.postgres': { type: 'number', defaultValue: 100, min: 20, max: 5000, description: 'Postgres probe latency threshold in milliseconds.', relatedPages: ['/ops'] },
  'health.latency_ms.meilisearch': { type: 'number', defaultValue: 150, min: 20, max: 5000, description: 'Meilisearch probe latency threshold in milliseconds.', relatedPages: ['/ops'] },
  'health.latency_ms.valkey': { type: 'number', defaultValue: 100, min: 20, max: 5000, description: 'Valkey probe latency threshold in milliseconds.', relatedPages: ['/ops'] },
  'health.latency_ms.ollama': { type: 'number', defaultValue: 750, min: 20, max: 5000, description: 'Ollama probe latency threshold in milliseconds.', relatedPages: ['/ops'] },
  'listings.refresh_cooldown_min': { type: 'number', defaultValue: 60, min: 5, max: 1440, description: 'Minimum minutes between manual refresh requests for one vehicle model.', relatedPages: ['/ops/sources'] },
  'gateway.escalation_wait_min': { type: 'number', defaultValue: 60, min: 5, max: 240, description: 'Maximum minutes an escalated scrape waits for a browser-capable worker.', relatedPages: ['/ops/workers', '/ops/queues'] },
  'worker.job_timeout_min': { type: 'number', defaultValue: 45, min: 5, max: 180, description: 'Minutes before a dispatched worker job is considered timed out.', relatedPages: ['/ops/workers', '/ops/queues'] },
  'listing.gone_after_missing': { type: 'number', defaultValue: 6, min: 2, max: 50, description: 'Complete crawls a listing must miss before it is marked gone.', relatedPages: ['/ops/sources'] },
  'publish_gate.strict': { type: 'boolean', defaultValue: false, description: 'Require listing readiness evidence before publishing listings to search.', relatedPages: ['/ops/settings', '/ops/readiness'] },
} as const

export type OperatorSettingKey = keyof typeof OPERATOR_SETTINGS
export type OperatorSettingDefinition = (typeof OPERATOR_SETTINGS)[OperatorSettingKey]
type ValueForDefinition<D> = D extends { type: 'boolean' } ? boolean : number
export type OperatorSettingValue<K extends OperatorSettingKey = OperatorSettingKey> = ValueForDefinition<(typeof OPERATOR_SETTINGS)[K]>

export function isOperatorSettingKey(key: string): key is OperatorSettingKey {
  return Object.hasOwn(OPERATOR_SETTINGS, key)
}

/** Invalid, missing, or tombstoned rows use the fallback; numeric rows are clamped. */
export function resolveOperatorSetting<K extends OperatorSettingKey>(
  key: K,
  row: { value: unknown; type: string } | null | undefined,
  fallbackValue?: OperatorSettingValue<K>,
): OperatorSettingValue<K> {
  const definition = OPERATOR_SETTINGS[key]

  if (definition.type === 'boolean') {
    if (row?.type === 'boolean' && typeof row.value === 'boolean') return row.value as OperatorSettingValue<K>
    return (typeof fallbackValue === 'boolean' ? fallbackValue : definition.defaultValue) as OperatorSettingValue<K>
  }

  const requiresInteger = !('integer' in definition) || definition.integer !== false
  const fallback = typeof fallbackValue === 'number'
    && Number.isFinite(fallbackValue)
    && (!requiresInteger || Number.isInteger(fallbackValue))
    ? fallbackValue
    : definition.defaultValue
  const clamp = (value: number) => Math.min(definition.max, Math.max(definition.min, value))
  if (row?.type !== 'number' || typeof row.value !== 'number' || !Number.isFinite(row.value) || (requiresInteger && !Number.isInteger(row.value))) {
    return clamp(fallback) as OperatorSettingValue<K>
  }

  return clamp(row.value) as OperatorSettingValue<K>
}
