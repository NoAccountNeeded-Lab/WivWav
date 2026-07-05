import type { HealthResponse, ServiceHealth } from '@wivwav/types'

export type ReadinessStatus = 'pass' | 'warn' | 'fail' | 'unavailable'

export interface QueueStats {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

export interface QueueSnapshot {
  name: string
  paused: boolean
  stats: QueueStats
}

export interface SourceSnapshot {
  id: string
  name: string
  status: string
  lastScrapedAt: string | null
  listingCount: number
}

export interface ScheduleSnapshot {
  id: string
  queue: string
  label: string
  enabled: boolean
}

export interface RunSnapshot {
  startedAt: string
  finishedAt: string | null
  success: boolean | null
}

export interface ListingSearchSnapshot {
  pagination: {
    total: number
  }
}

export type ResourceState<T> =
  | { status: 'loaded'; data: T }
  | { status: 'unavailable'; error: string }

export interface ReadinessInputs {
  health: ResourceState<HealthResponse>
  queues: ResourceState<QueueSnapshot[]>
  sources: ResourceState<SourceSnapshot[]>
  schedules: ResourceState<ScheduleSnapshot[]>
  runs: ResourceState<RunSnapshot[]>
  listingSearch: ResourceState<ListingSearchSnapshot>
  now?: Date
}

export interface ReadinessCheck {
  id: string
  title: string
  status: ReadinessStatus
  summary: string
  remediation: string
  href: string
}

export interface ReadinessReport {
  checks: ReadinessCheck[]
  totals: Record<ReadinessStatus, number>
  overallStatus: ReadinessStatus
}

const RECENT_SCRAPE_PASS_MS = 24 * 60 * 60 * 1000
const RECENT_SCRAPE_WARN_MS = 48 * 60 * 60 * 1000

const CRITICAL_QUEUE_NAMES = [
  'source-scrape',
  'detail-crawl',
  'detail-extract',
  'geocode',
  'deduplicate',
  'vin-enrich',
  'nhtsa-recalls',
  'nhtsa-complaints',
  'nhtsa-safety-ratings',
] as const

const CRITICAL_SCHEDULE_IDS = [
  'geocode',
  'deduplicate',
  'vin-enrich',
  'nhtsa-recalls',
  'nhtsa-complaints',
  'nhtsa-safety-ratings',
] as const

const CRITICAL_SOURCE_SCHEDULE_QUEUES = new Set([
  'detail-crawl',
  'detail-extract',
])

export function buildReadinessReport(inputs: ReadinessInputs): ReadinessReport {
  const checks = [
    checkApiHealth(inputs.health),
    checkServiceHealth('db', 'Database availability', inputs.health, 'postgres', '/status'),
    checkServiceHealth('valkey', 'Valkey availability', inputs.health, 'valkey', '/status'),
    checkServiceHealth('meilisearch', 'Meilisearch availability', inputs.health, 'meilisearch', '/status'),
    checkActiveListings(inputs.sources),
    checkSearchIndex(inputs.listingSearch),
    checkCriticalSchedules(inputs.schedules),
    checkCriticalQueues(inputs.queues),
    checkSourcesNeedingRemap(inputs.sources),
    checkRecentScrapeActivity(inputs.runs, inputs.now ?? new Date()),
  ]

  const totals = checks.reduce<Record<ReadinessStatus, number>>(
    (acc, check) => ({ ...acc, [check.status]: acc[check.status] + 1 }),
    { pass: 0, warn: 0, fail: 0, unavailable: 0 },
  )

  return {
    checks,
    totals,
    overallStatus: getOverallStatus(checks),
  }
}

function checkApiHealth(health: ResourceState<HealthResponse>): ReadinessCheck {
  if (health.status === 'unavailable') {
    return {
      id: 'api-health',
      title: 'API health',
      status: 'unavailable',
      summary: 'The web app could not reach the API health endpoint.',
      remediation: `Open System Status and verify the API service is running. Error: ${health.error}`,
      href: '/status',
    }
  }

  if (health.data.status === 'ok') {
    return {
      id: 'api-health',
      title: 'API health',
      status: 'pass',
      summary: 'The API health endpoint reports all required services as operational.',
      remediation: 'No action needed.',
      href: '/status',
    }
  }

  return {
    id: 'api-health',
    title: 'API health',
    status: health.data.status === 'degraded' ? 'warn' : 'fail',
    summary: `The API health endpoint reports ${health.data.status}.`,
    remediation: 'Open System Status to identify the failing service before sending users to the site.',
    href: '/status',
  }
}

function checkServiceHealth(
  id: string,
  title: string,
  health: ResourceState<HealthResponse>,
  serviceName: keyof HealthResponse['services'],
  href: string,
): ReadinessCheck {
  if (health.status === 'unavailable') {
    return unavailableCheck(id, title, 'System Status could not load service health.', href, health.error)
  }

  const service = health.data.services[serviceName]
  if (!service) return unavailableCheck(id, title, 'The health response did not include this service.', href)

  const label = formatServiceDetail(service)
  if (service.status === 'up') {
    return {
      id,
      title,
      status: 'pass',
      summary: `${title} is healthy. ${label}`,
      remediation: 'No action needed.',
      href,
    }
  }

  if (service.status === 'degraded') {
    return {
      id,
      title,
      status: 'warn',
      summary: `${title} is responding slowly. ${label}`,
      remediation: 'Open System Status and check latency before launch or handoff.',
      href,
    }
  }

  return {
    id,
    title,
    status: 'fail',
    summary: `${title} is down or unreachable.`,
    remediation: 'Open System Status, then restart or reconnect the backing service before launch.',
    href,
  }
}

function checkActiveListings(sources: ResourceState<SourceSnapshot[]>): ReadinessCheck {
  if (sources.status === 'unavailable') {
    return unavailableCheck('active-listings', 'Active listings present', 'Sources could not be loaded.', '/ops/sources', sources.error)
  }

  const total = sources.data.reduce((sum, source) => sum + source.listingCount, 0)
  if (total > 0) {
    return {
      id: 'active-listings',
      title: 'Active listings present',
      status: 'pass',
      summary: `${total.toLocaleString()} listings are currently attributed to configured sources.`,
      remediation: 'No action needed.',
      href: '/ops/sources',
    }
  }

  return {
    id: 'active-listings',
    title: 'Active listings present',
    status: 'fail',
    summary: 'No active source listings are present.',
    remediation: 'Open Sources and run at least one active source, then sync Meilisearch from Queues.',
    href: '/ops/sources',
  }
}

function checkSearchIndex(listingSearch: ResourceState<ListingSearchSnapshot>): ReadinessCheck {
  if (listingSearch.status === 'unavailable') {
    return unavailableCheck('search-index', 'Search index reachable', 'The listings search endpoint did not respond.', '/ops/queues', listingSearch.error)
  }

  const total = listingSearch.data.pagination.total
  if (total > 0) {
    return {
      id: 'search-index',
      title: 'Search index reachable',
      status: 'pass',
      summary: `Search responded with ${total.toLocaleString()} indexed listings.`,
      remediation: 'No action needed.',
      href: '/filters',
    }
  }

  return {
    id: 'search-index',
    title: 'Search index reachable',
    status: 'warn',
    summary: 'Search responded, but the index returned zero listings.',
    remediation: 'Open Queues and run Sync Meilisearch after confirming sources have listings.',
    href: '/ops/queues',
  }
}

function checkCriticalSchedules(schedules: ResourceState<ScheduleSnapshot[]>): ReadinessCheck {
  if (schedules.status === 'unavailable') {
    return unavailableCheck('critical-schedules', 'Critical schedules enabled', 'Schedules could not be loaded.', '/ops/schedules', schedules.error)
  }

  const enabledSourceSchedules = schedules.data.filter(schedule => schedule.queue === 'source-scrape' && schedule.enabled)
  const disabled = schedules.data
    .filter(schedule =>
      (
        CRITICAL_SCHEDULE_IDS.includes(schedule.id as (typeof CRITICAL_SCHEDULE_IDS)[number]) ||
        CRITICAL_SOURCE_SCHEDULE_QUEUES.has(schedule.queue)
      ) &&
      !schedule.enabled,
    )
    .map(schedule => schedule.label)

  if (enabledSourceSchedules.length === 0) disabled.unshift('At least one source scrape schedule')

  if (disabled.length === 0) {
    return {
      id: 'critical-schedules',
      title: 'Critical schedules enabled',
      status: 'pass',
      summary: 'All critical background schedules are enabled.',
      remediation: 'No action needed.',
      href: '/ops/schedules',
    }
  }

  return {
    id: 'critical-schedules',
    title: 'Critical schedules enabled',
    status: 'fail',
    summary: `${disabled.length} critical schedule${disabled.length === 1 ? ' is' : 's are'} disabled.`,
    remediation: `Open Schedules and enable: ${disabled.join(', ')}.`,
    href: '/ops/schedules',
  }
}

function checkCriticalQueues(queues: ResourceState<QueueSnapshot[]>): ReadinessCheck {
  if (queues.status === 'unavailable') {
    return unavailableCheck('critical-queues', 'No critical failed queues', 'Queues could not be loaded.', '/ops/queues', queues.error)
  }

  const criticalQueues = queues.data.filter(queue => CRITICAL_QUEUE_NAMES.includes(queue.name as (typeof CRITICAL_QUEUE_NAMES)[number]))
  const failed = criticalQueues.filter(queue => queue.stats.failed > 0)
  const paused = criticalQueues.filter(queue => queue.paused)

  if (failed.length > 0) {
    return {
      id: 'critical-queues',
      title: 'No critical failed queues',
      status: 'fail',
      summary: `${failed.length} critical queue${failed.length === 1 ? ' has' : 's have'} failed jobs.`,
      remediation: `Open Queues and inspect failures for: ${failed.map(queue => queue.name).join(', ')}.`,
      href: '/ops/queues',
    }
  }

  if (paused.length > 0) {
    return {
      id: 'critical-queues',
      title: 'No critical failed queues',
      status: 'warn',
      summary: `${paused.length} critical queue${paused.length === 1 ? ' is' : 's are'} paused.`,
      remediation: `Open Queues and resume if this is not an intentional maintenance window: ${paused.map(queue => queue.name).join(', ')}.`,
      href: '/ops/queues',
    }
  }

  return {
    id: 'critical-queues',
    title: 'No critical failed queues',
    status: 'pass',
    summary: 'Critical queues have no failed jobs and are not paused.',
    remediation: 'No action needed.',
    href: '/ops/queues',
  }
}

function checkSourcesNeedingRemap(sources: ResourceState<SourceSnapshot[]>): ReadinessCheck {
  if (sources.status === 'unavailable') {
    return unavailableCheck('sources-remap', 'No sources stuck in needs_remapping', 'Sources could not be loaded.', '/ops/sources', sources.error)
  }

  const stuckSources = sources.data.filter(source => source.status === 'needs_remapping')
  if (stuckSources.length === 0) {
    return {
      id: 'sources-remap',
      title: 'No sources stuck in needs_remapping',
      status: 'pass',
      summary: 'No source is waiting for selector remapping.',
      remediation: 'No action needed.',
      href: '/ops/sources',
    }
  }

  return {
    id: 'sources-remap',
    title: 'No sources stuck in needs_remapping',
    status: 'fail',
    summary: `${stuckSources.length} source${stuckSources.length === 1 ? ' needs' : 's need'} selector remapping.`,
    remediation: `Open Sources or AI and resolve remapping for: ${stuckSources.map(source => source.name).join(', ')}.`,
    href: '/ops/ai',
  }
}

function checkRecentScrapeActivity(runs: ResourceState<RunSnapshot[]>, now: Date): ReadinessCheck {
  if (runs.status === 'unavailable') {
    return unavailableCheck('recent-scrape', 'Recent scrape activity', 'Scraper runs could not be loaded.', '/ops/runs', runs.error)
  }

  const latestSuccess = runs.data
    .filter((run): run is RunSnapshot & { finishedAt: string; success: true } => run.success === true && run.finishedAt !== null)
    .sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime())[0]

  if (!latestSuccess) {
    return {
      id: 'recent-scrape',
      title: 'Recent scrape activity',
      status: 'fail',
      summary: 'No successful scraper run is recorded.',
      remediation: 'Open Sources and run a scrape, then confirm the run succeeds in Scraper Runs.',
      href: '/ops/runs',
    }
  }

  const ageMs = now.getTime() - new Date(latestSuccess.finishedAt).getTime()
  if (ageMs <= RECENT_SCRAPE_PASS_MS) {
    return {
      id: 'recent-scrape',
      title: 'Recent scrape activity',
      status: 'pass',
      summary: `Last successful scrape finished ${formatRelativeAge(ageMs)} ago.`,
      remediation: 'No action needed.',
      href: '/ops/runs',
    }
  }

  return {
    id: 'recent-scrape',
    title: 'Recent scrape activity',
    status: ageMs <= RECENT_SCRAPE_WARN_MS ? 'warn' : 'fail',
    summary: `Last successful scrape finished ${formatRelativeAge(ageMs)} ago.`,
    remediation: 'Open Sources and run a fresh scrape before launch or handoff.',
    href: '/ops/runs',
  }
}

function unavailableCheck(id: string, title: string, summary: string, href: string, error?: string): ReadinessCheck {
  return {
    id,
    title,
    status: 'unavailable',
    summary,
    remediation: error ? `Open the linked ops page and retry after fixing: ${error}` : 'Open the linked ops page and retry after service data is available.',
    href,
  }
}

function getOverallStatus(checks: ReadinessCheck[]): ReadinessStatus {
  if (checks.some(check => check.status === 'fail')) return 'fail'
  if (checks.some(check => check.status === 'unavailable')) return 'unavailable'
  if (checks.some(check => check.status === 'warn')) return 'warn'
  return 'pass'
}

function formatServiceDetail(service: ServiceHealth): string {
  if (service.message) return service.message
  if (service.latencyMs != null) return `${service.latencyMs} ms response.`
  if (service.lastRunAt) return `Last run at ${service.lastRunAt}.`
  return ''
}

function formatRelativeAge(ageMs: number): string {
  const minutes = Math.max(0, Math.round(ageMs / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}
