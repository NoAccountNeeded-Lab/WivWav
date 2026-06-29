export type QueueStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
export type ServiceStatus = 'up' | 'degraded' | 'down' | 'optional_offline'

export interface QueueStats {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

export interface RefreshQueueState {
  name: 'source-scrape' | 'detail-crawl' | 'detail-extract' | 'geocode'
  paused: boolean
  stats: QueueStats
  lastJobAt: string | null
  lastFinishedAt: string | null
  lastStatus: QueueStatus | null
  recentFailureCount: number
  recentFailureReason: string | null
}

export interface ListingRefreshStatus {
  generatedAt: string
  sources: {
    total: number
    active: number
    needsAttention: number
    totalListings: number
    lastScrapedAt: string | null
  }
  listings: {
    active: number
    mapReady: number
    missingLocations: number
  }
  latestScrapeRun: {
    startedAt: string
    finishedAt: string | null
    success: boolean | null
    listingsFound: number | null
    listingsNew: number | null
    listingsUpdated: number | null
    errorMessage: string | null
    sourceName: string | null
  } | null
  queues: RefreshQueueState[]
}

export interface WorkflowHealth {
  services: {
    meilisearch: { status: ServiceStatus }
    valkey: { status: ServiceStatus }
    scraper: { status: ServiceStatus }
  }
}

export interface RefreshSource {
  id: string
  name: string
  status: string
}

export type WorkflowStepStatus = 'complete' | 'actionable' | 'running' | 'warning' | 'blocked'
export type WorkflowActionId = 'run-sources' | 'run-detail-crawl' | 'run-detail-extract' | 'run-geocode' | 'sync-search'

export interface WorkflowAction {
  id: WorkflowActionId
  label: string
  disabled: boolean
  disabledReason: string | null
}

export interface WorkflowStep {
  id: 'scrape' | 'details' | 'geocode' | 'sync' | 'verify'
  title: string
  status: WorkflowStepStatus
  lastRunAt: string | null
  countLabel: string
  recommendation: string
  actions: WorkflowAction[]
}

export function getActiveSourceIds(sources: RefreshSource[]): string[] {
  return [
    ...new Set(
      sources
        .filter(source => source.status === 'active')
        .map(source => source.id.trim())
        .filter(sourceId => sourceId.length > 0),
    ),
  ]
}

export function buildListingRefreshSteps(
  status: ListingRefreshStatus,
  health: WorkflowHealth | null,
): WorkflowStep[] {
  const sourceQueue = findQueue(status, 'source-scrape')
  const detailCrawlQueue = findQueue(status, 'detail-crawl')
  const detailExtractQueue = findQueue(status, 'detail-extract')
  const geocodeQueue = findQueue(status, 'geocode')
  const queueServiceDown = health?.services.valkey.status === 'down'
  const scraperDown = health?.services.scraper.status === 'down'
  const searchDown = health?.services.meilisearch.status === 'down'
  const sourceQueueBusy = isQueueBusy(sourceQueue)
  const detailsBusy = isQueueBusy(detailCrawlQueue) || isQueueBusy(detailExtractQueue)
  const geocodeBusy = isQueueBusy(geocodeQueue)

  return [
    {
      id: 'scrape',
      title: 'Scrape sources',
      status: firstStatus([
        [queueServiceDown || scraperDown || status.sources.active === 0, 'blocked'],
        [sourceQueueBusy, 'running'],
        [status.sources.needsAttention > 0 || sourceQueue.recentFailureCount > 0, 'warning'],
        [status.sources.lastScrapedAt !== null, 'complete'],
      ]),
      lastRunAt: status.sources.lastScrapedAt,
      countLabel: `${status.sources.active.toLocaleString()} active sources, ${status.sources.totalListings.toLocaleString()} source listings`,
      recommendation: sourceRecommendation(status, sourceQueue, queueServiceDown, scraperDown),
      actions: [
        {
          id: 'run-sources',
          label: 'Run active sources',
          disabled: queueServiceDown || scraperDown || status.sources.active === 0 || sourceQueue.paused,
          disabledReason: actionDisabledReason([
            [queueServiceDown, 'Valkey is unavailable, so jobs cannot be enqueued.'],
            [scraperDown, 'The scraper is unavailable.'],
            [status.sources.active === 0, 'No active sources are configured.'],
            [sourceQueue.paused, 'The source scrape queue is paused.'],
          ]),
        },
      ],
    },
    {
      id: 'details',
      title: 'Process details',
      status: firstStatus([
        [queueServiceDown || status.listings.active === 0, 'blocked'],
        [detailsBusy, 'running'],
        [detailCrawlQueue.paused || detailExtractQueue.paused || detailCrawlQueue.recentFailureCount > 0 || detailExtractQueue.recentFailureCount > 0, 'warning'],
        [detailCrawlQueue.lastJobAt !== null && detailExtractQueue.lastJobAt !== null, 'complete'],
      ]),
      lastRunAt: latestIso([detailCrawlQueue.lastJobAt, detailExtractQueue.lastJobAt]),
      countLabel: `${pendingCount(detailCrawlQueue).toLocaleString()} crawl jobs pending, ${pendingCount(detailExtractQueue).toLocaleString()} extract jobs pending`,
      recommendation: detailRecommendation(status, detailCrawlQueue, detailExtractQueue, queueServiceDown),
      actions: [
        queueAction('run-detail-crawl', 'Start detail crawl', detailCrawlQueue, queueServiceDown, status.listings.active === 0),
        queueAction('run-detail-extract', 'Extract stored details', detailExtractQueue, queueServiceDown, status.listings.active === 0),
      ],
    },
    {
      id: 'geocode',
      title: 'Geocode missing locations',
      status: firstStatus([
        [queueServiceDown || status.listings.active === 0, 'blocked'],
        [geocodeBusy, 'running'],
        [geocodeQueue.paused || geocodeQueue.recentFailureCount > 0, 'warning'],
        [status.listings.missingLocations === 0 && status.listings.active > 0, 'complete'],
      ]),
      lastRunAt: geocodeQueue.lastJobAt,
      countLabel: `${status.listings.missingLocations.toLocaleString()} missing locations, ${status.listings.mapReady.toLocaleString()} map-ready listings`,
      recommendation: geocodeRecommendation(status, geocodeQueue, queueServiceDown),
      actions: [
        {
          id: 'run-geocode',
          label: 'Run geocoder',
          disabled: queueServiceDown || geocodeQueue.paused || status.listings.active === 0 || status.listings.missingLocations === 0,
          disabledReason: actionDisabledReason([
            [queueServiceDown, 'Valkey is unavailable, so jobs cannot be enqueued.'],
            [geocodeQueue.paused, 'The geocode queue is paused.'],
            [status.listings.active === 0, 'No active listings need locations.'],
            [status.listings.missingLocations === 0, 'All active listings already have map coordinates.'],
          ]),
        },
      ],
    },
    {
      id: 'sync',
      title: 'Sync search index',
      status: firstStatus([
        [searchDown || status.listings.active === 0, 'blocked'],
        [status.listings.missingLocations > 0, 'warning'],
      ]),
      lastRunAt: null,
      countLabel: `${status.listings.active.toLocaleString()} active listings to index`,
      recommendation: syncRecommendation(status, searchDown),
      actions: [
        {
          id: 'sync-search',
          label: 'Sync search index',
          disabled: searchDown || status.listings.active === 0,
          disabledReason: actionDisabledReason([
            [searchDown, 'Meilisearch is unavailable.'],
            [status.listings.active === 0, 'No active listings are available to index.'],
          ]),
        },
      ],
    },
    {
      id: 'verify',
      title: 'Verify search and map readiness',
      status: firstStatus([
        [searchDown || status.listings.active === 0, 'blocked'],
        [status.listings.missingLocations > 0 || status.listings.mapReady === 0, 'warning'],
        [true, 'complete'],
      ]),
      lastRunAt: null,
      countLabel: `${status.listings.mapReady.toLocaleString()} of ${status.listings.active.toLocaleString()} active listings have coordinates`,
      recommendation: verifyRecommendation(status, searchDown),
      actions: [],
    },
  ]
}

function findQueue(status: ListingRefreshStatus, name: RefreshQueueState['name']): RefreshQueueState {
  return status.queues.find(queue => queue.name === name) ?? {
    name,
    paused: false,
    stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
    lastJobAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    recentFailureCount: 0,
    recentFailureReason: null,
  }
}

function firstStatus(checks: Array<[boolean, WorkflowStepStatus]>): WorkflowStepStatus {
  return checks.find(([condition]) => condition)?.[1] ?? 'actionable'
}

function pendingCount(queue: RefreshQueueState): number {
  return queue.stats.waiting + queue.stats.active + queue.stats.delayed
}

function isQueueBusy(queue: RefreshQueueState): boolean {
  return queue.stats.waiting + queue.stats.active > 0
}

function latestIso(values: Array<string | null>): string | null {
  const times = values
    .filter((value): value is string => value !== null)
    .map(value => new Date(value).getTime())
    .filter(time => Number.isFinite(time))
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
}

function actionDisabledReason(checks: Array<[boolean, string]>): string | null {
  return checks.find(([condition]) => condition)?.[1] ?? null
}

function queueAction(
  id: Extract<WorkflowActionId, 'run-detail-crawl' | 'run-detail-extract'>,
  label: string,
  queue: RefreshQueueState,
  queueServiceDown: boolean,
  noListings: boolean,
): WorkflowAction {
  return {
    id,
    label,
    disabled: queueServiceDown || queue.paused || noListings,
    disabledReason: actionDisabledReason([
      [queueServiceDown, 'Valkey is unavailable, so jobs cannot be enqueued.'],
      [queue.paused, `The ${queue.name} queue is paused.`],
      [noListings, 'No active listings are available to process.'],
    ]),
  }
}

function sourceRecommendation(
  status: ListingRefreshStatus,
  queue: RefreshQueueState,
  queueServiceDown: boolean,
  scraperDown: boolean,
): string {
  if (queueServiceDown) return 'Restore Valkey before enqueueing scrape jobs.'
  if (scraperDown) return 'Restore the scraper before starting a refresh.'
  if (status.sources.active === 0) return 'Enable at least one source before scraping.'
  if (isQueueBusy(queue)) return 'Wait for the active source scrape jobs to finish.'
  if (status.sources.needsAttention > 0) return 'Review sources needing attention, then re-run active sources.'
  return status.sources.lastScrapedAt ? 'Sources have scraped recently. Continue to detail processing.' : 'Start by running active sources.'
}

function detailRecommendation(
  status: ListingRefreshStatus,
  crawl: RefreshQueueState,
  extract: RefreshQueueState,
  queueServiceDown: boolean,
): string {
  if (queueServiceDown) return 'Restore Valkey before enqueueing detail jobs.'
  if (status.listings.active === 0) return 'Scrape sources before processing listing details.'
  if (isQueueBusy(crawl) || isQueueBusy(extract)) return 'Wait for detail jobs to drain before geocoding.'
  if (crawl.paused || extract.paused) return 'Resume paused detail queues before processing details.'
  if (crawl.recentFailureCount > 0 || extract.recentFailureCount > 0) return 'Inspect recent detail failures before continuing.'
  return 'Run detail crawl, then detail extract, before geocoding.'
}

function geocodeRecommendation(
  status: ListingRefreshStatus,
  queue: RefreshQueueState,
  queueServiceDown: boolean,
): string {
  if (queueServiceDown) return 'Restore Valkey before enqueueing geocode jobs.'
  if (status.listings.active === 0) return 'Scrape sources before geocoding.'
  if (isQueueBusy(queue)) return 'Wait for geocoding to finish, then sync the search index.'
  if (queue.paused) return 'Resume the geocode queue before resolving locations.'
  if (status.listings.missingLocations === 0) return 'Locations are ready. Sync the search index next.'
  return 'Run geocoding to add coordinates for map pins.'
}

function syncRecommendation(status: ListingRefreshStatus, searchDown: boolean): string {
  if (searchDown) return 'Restore Meilisearch before syncing the index.'
  if (status.listings.active === 0) return 'Scrape listings before syncing search.'
  if (status.listings.missingLocations > 0) return 'You can sync now, but map pins will be incomplete until geocoding finishes.'
  return 'Sync the search index so new listing and location data appear in search.'
}

function verifyRecommendation(status: ListingRefreshStatus, searchDown: boolean): string {
  if (searchDown) return 'Search is unavailable, so verification cannot pass yet.'
  if (status.listings.active === 0) return 'No active listings are available to verify.'
  if (status.listings.missingLocations > 0) return 'Run geocoding and sync again before considering the map ready.'
  if (status.listings.mapReady === 0) return 'Listings exist, but none have usable map coordinates.'
  return 'Search and map readiness look good. Spot-check the public listings page.'
}
