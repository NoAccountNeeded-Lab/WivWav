import type { HealthResponse, ServiceHealth } from '@wivwav/types'

export interface QueueStats {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

export interface QueueRow {
  name: string
  paused: boolean
  stats: QueueStats
}

export interface SourceRow {
  id: string
  name: string
  status: string
  lastScrapedAt: string | null
  /** Timestamp of the most recent complete (all-pages) crawl. */
  lastFullCrawlAt: string | null
  /** Timestamp of the most recent observation (complete or partial). */
  lastObservedAt: string | null
  listingCount: number
  errorMessage: string | null
  /** Number of possibly_gone listings — an elevated count relative to listingCount indicates index-absence discrepancy. */
  possiblyGoneCount: number
}

export interface RunRow {
  id: string
  sourceId: string
  sourceName: string | null
  startedAt: string
  finishedAt: string | null
  success: boolean | null
  listingsFound: number | null
  listingsNew: number | null
  listingsUpdated: number | null
  errorMessage: string | null
}

export interface ScheduleEntry {
  id: string
  queue: string
  label: string
  enabled: boolean
  lastRunAt: string | null
  lastStatus: 'active' | 'completed' | 'failed' | null
  recentFailureCount: number
  recentFailureReason: string | null
}

export type OverviewSeverity = 'good' | 'warning' | 'critical' | 'unknown'

export interface OverviewCard {
  id: string
  label: string
  value: string
  detail: string
  severity: OverviewSeverity
  href?: string
}

export interface AttentionItem {
  id: string
  title: string
  detail: string
  href: string
  severity: OverviewSeverity
}

export interface OverviewModel {
  overall: {
    label: string
    detail: string
    severity: OverviewSeverity
  }
  healthCards: OverviewCard[]
  freshnessCards: OverviewCard[]
  attention: AttentionItem[]
  telemetry: OverviewCard[]
}

export type OverviewResourceKey = 'health' | 'queues' | 'sources' | 'runs' | 'schedules'

export interface OverviewInput {
  health: HealthResponse | null
  queues: QueueRow[] | null
  sources: SourceRow[] | null
  runs: RunRow[] | null
  schedules: ScheduleEntry[] | null
  errors: Partial<Record<OverviewResourceKey, string>>
  /**
   * Marks a resource as still awaiting its first response (E5: independent
   * per-section streaming). While pending, a null value renders as "not yet
   * loaded" rather than being defaulted to an "unavailable" error — the
   * default error text below only applies once a resource has genuinely
   * settled with no data and no explicit error.
   */
  pending?: Partial<Record<OverviewResourceKey, boolean>>
  now: Date
}

const STALE_SCRAPE_MS = 24 * 60 * 60 * 1000
const VERY_STALE_SCRAPE_MS = 48 * 60 * 60 * 1000

export function buildOpsOverview(input: OverviewInput): OverviewModel {
  const activeListingCount = input.sources?.reduce((sum, source) => sum + source.listingCount, 0) ?? null
  const failedQueueJobs = input.queues?.reduce((sum, queue) => sum + queue.stats.failed, 0) ?? null
  const pausedQueues = input.queues?.filter(queue => queue.paused) ?? []
  const failedSchedules = input.schedules?.filter(schedule => schedule.recentFailureCount > 0) ?? []
  const disabledSchedules = input.schedules?.filter(schedule => !schedule.enabled) ?? []
  const sourcesNeedingRemap = input.sources?.filter(source => source.status === 'needs_remapping') ?? []
  const erroredSources = input.sources?.filter(source => source.status === 'error') ?? []
  const lastSuccessfulRun = findLastSuccessfulRun(input.runs)
  const lastScrapeAgeMs = lastSuccessfulRun?.finishedAt ? input.now.getTime() - new Date(lastSuccessfulRun.finishedAt).getTime() : null
  const geocodeQueue = input.queues?.find(queue => queue.name === 'geocode') ?? null
  const healthServices = input.health?.services

  const healthError = input.errors.health ?? (input.health === null && !input.pending?.health ? 'Service health telemetry unavailable' : undefined)
  const queueError = input.errors.queues ?? (input.queues === null && !input.pending?.queues ? 'Queue telemetry unavailable' : undefined)
  const sourceError = input.errors.sources ?? (input.sources === null && !input.pending?.sources ? 'Source telemetry unavailable' : undefined)
  const runError = input.errors.runs ?? (input.runs === null && !input.pending?.runs ? 'Scraper run telemetry unavailable' : undefined)
  const scheduleError = input.errors.schedules ?? (input.schedules === null && !input.pending?.schedules ? 'Schedule telemetry unavailable' : undefined)

  const attention: AttentionItem[] = [
    ...serviceAttention(input.health, healthError),
    ...sourceAttention(sourcesNeedingRemap, erroredSources, sourceError),
    ...queueAttention(failedQueueJobs, pausedQueues, queueError),
    ...scheduleAttention(disabledSchedules, failedSchedules, scheduleError),
    ...freshnessAttention(lastSuccessfulRun, lastScrapeAgeMs, runError, input.now),
    ...geocodeAttention(geocodeQueue, queueError),
    ...inventoryDiscrepancyAttention(input.sources, sourceError),
  ]

  const healthCards: OverviewCard[] = [
    serviceCard('api', 'API', healthError ? null : serviceFromHealth(input.health, 'api'), healthError, '/status'),
    serviceCard('postgres', 'Database', serviceFromHealth(input.health, 'postgres'), healthError, '/status'),
    serviceCard('valkey', 'Valkey', serviceFromHealth(input.health, 'valkey'), healthError, '/ops/queues'),
    serviceCard('meilisearch', 'Meilisearch', serviceFromHealth(input.health, 'meilisearch'), healthError, '/status'),
    {
      id: 'queues',
      label: 'Queues',
      value: queueError ? 'Unavailable' : failedQueueJobs == null ? 'Unavailable' : failedQueueJobs > 0 ? `${failedQueueJobs} failed` : 'No failed jobs',
      detail: queueError ?? queueSummary(input.queues),
      severity: queueError ? 'unknown' : failedQueueJobs && failedQueueJobs > 0 ? 'critical' : pausedQueues.length > 0 ? 'warning' : 'good',
      href: '/ops/queues',
    },
    serviceCard('scraper', 'Scraper', healthServices?.scraper, healthError, '/ops/runs'),
  ]

  const freshnessCards: OverviewCard[] = [
    {
      id: 'active-listings',
      label: 'Active listings',
      value: activeListingCount == null ? 'Unavailable' : activeListingCount.toLocaleString(),
      detail: sourceError ?? `${input.sources?.length ?? 0} configured sources`,
      severity: sourceError ? 'unknown' : activeListingCount === 0 ? 'warning' : 'good',
      href: '/ops/sources',
    },
    {
      id: 'last-successful-scrape',
      label: 'Last successful scrape',
      value: runError ? 'Unavailable' : lastSuccessfulRun?.finishedAt ? formatRelative(lastSuccessfulRun.finishedAt, input.now) : 'Not yet tracked',
      detail: runError ?? (lastSuccessfulRun ? `${lastSuccessfulRun.sourceName ?? 'Unknown source'} finished ${formatDateTime(lastSuccessfulRun.finishedAt)}` : 'No successful scraper run found in recent history'),
      severity: runError ? 'unknown' : staleSeverity(lastScrapeAgeMs),
      href: '/ops/runs',
    },
    {
      id: 'sources-needing-remap',
      label: 'Sources needing remap',
      value: sourceError ? 'Unavailable' : String(sourcesNeedingRemap.length),
      detail: sourceError ?? (sourcesNeedingRemap.length > 0 ? sourcesNeedingRemap.map(source => source.name).join(', ') : 'No source remaps currently flagged'),
      severity: sourceError ? 'unknown' : sourcesNeedingRemap.length > 0 ? 'critical' : 'good',
      href: '/ops/sources',
    },
    {
      id: 'geocode-readiness',
      label: 'Geocode readiness',
      value: queueError ? 'Unavailable' : geocodeQueue ? queueReadinessLabel(geocodeQueue) : 'Not yet tracked',
      detail: queueError ?? (geocodeQueue ? queueReadinessDetail(geocodeQueue) : 'Missing-coordinate count is not yet tracked by the API'),
      severity: queueError ? 'unknown' : geocodeQueue ? queueReadinessSeverity(geocodeQueue) : 'unknown',
      href: '/ops/queues',
    },
    {
      id: 'search-readiness',
      label: 'Search readiness',
      value: serviceLabel(healthServices?.meilisearch),
      detail: healthServices?.meilisearch ? serviceDetail(healthServices.meilisearch) : healthError ?? 'Search index freshness is not yet tracked after sync jobs',
      severity: healthError ? 'unknown' : serviceSeverity(healthServices?.meilisearch),
      href: '/ops/queues',
    },
  ]

  const telemetry: OverviewCard[] = [
    {
      id: 'missing-coordinates',
      label: 'Listings missing coordinates',
      value: 'Not yet tracked',
      detail: 'The API does not currently expose a missing-coordinate count. Use the geocode queue status as the available proxy.',
      severity: 'unknown',
      href: '/ops/queues',
    },
    {
      id: 'search-sync-age',
      label: 'Search sync age',
      value: 'Not yet tracked',
      detail: 'The API exposes the manual sync action but not the last successful Meilisearch sync time.',
      severity: 'unknown',
      href: '/ops/queues',
    },
    {
      id: 'listing-freshness-window',
      label: 'Possibly-gone listings',
      value: sourceError ? 'Unavailable' : String(input.sources?.reduce((sum, s) => sum + s.possiblyGoneCount, 0) ?? 0),
      detail: sourceError ?? 'Listings that were absent from the most recent source crawl. Consecutive absences promote to gone after 3 complete crawls.',
      severity: sourceError ? 'unknown' : 'good',
      href: '/ops/sources',
    },
  ]

  const criticalCount = attention.filter(item => item.severity === 'critical').length
  const warningCount = attention.filter(item => item.severity === 'warning').length
  const unavailableCount = [...healthCards, ...freshnessCards].filter(card => card.severity === 'unknown').length
  const overallSeverity: OverviewSeverity = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : unavailableCount > 0 ? 'unknown' : 'good'

  return {
    overall: {
      severity: overallSeverity,
      label: overallLabel(overallSeverity),
      detail: attention.length > 0
        ? `${criticalCount} critical, ${warningCount} warning, ${unavailableCount} unavailable signals`
        : 'No active failures in available telemetry',
    },
    healthCards,
    freshnessCards,
    attention: attention.length > 0 ? attention : [{
      id: 'no-attention-needed',
      title: 'No immediate attention needed',
      detail: 'Available services, queues, sources, and schedules are reporting healthy states.',
      href: '/ops/runs',
      severity: unavailableCount > 0 ? 'unknown' : 'good',
    }],
    telemetry,
  }
}

function serviceCard(id: string, label: string, health: ServiceHealth | null | undefined, error: string | undefined, href: string): OverviewCard {
  return {
    id,
    label,
    value: error ? 'Unavailable' : serviceLabel(health),
    detail: error ?? serviceDetail(health),
    severity: error ? 'unknown' : serviceSeverity(health),
    href,
  }
}

function serviceFromHealth(health: HealthResponse | null, service: keyof HealthResponse['services'] | 'api'): ServiceHealth | null {
  if (service === 'api') {
    if (!health) return null
    return { status: health.status === 'ok' ? 'up' : health.status === 'degraded' ? 'degraded' : 'down' }
  }
  return health?.services[service] ?? null
}

function serviceLabel(health: ServiceHealth | null | undefined): string {
  if (!health) return 'Unavailable'
  if (health.status === 'optional_offline') return 'Optional offline'
  return health.status === 'up' ? 'Up' : health.status === 'degraded' ? 'Degraded' : 'Down'
}

function serviceSeverity(health: ServiceHealth | null | undefined): OverviewSeverity {
  if (!health) return 'unknown'
  if (health.status === 'down') return 'critical'
  if (health.status === 'degraded' || health.status === 'optional_offline') return 'warning'
  return 'good'
}

function serviceDetail(health: ServiceHealth | null | undefined): string {
  if (!health) return 'Waiting for API data'
  if (health.message) return health.message
  if (health.lastRunAt) return `Last successful run ${formatDateTime(health.lastRunAt)}`
  if (health.latencyMs != null) return `${health.latencyMs} ms response`
  return 'No diagnostic detail returned — check service logs'
}

function queueSummary(queues: QueueRow[] | null): string {
  if (!queues) return 'Waiting for queue data'
  const active = queues.filter(queue => queue.stats.active > 0).length
  const paused = queues.filter(queue => queue.paused).length
  return `${queues.length} queues, ${active} active, ${paused} paused`
}

function findLastSuccessfulRun(runs: RunRow[] | null): RunRow | null {
  if (!runs) return null
  return runs
    .filter(run => run.success === true && run.finishedAt)
    .sort((a, b) => new Date(b.finishedAt ?? 0).getTime() - new Date(a.finishedAt ?? 0).getTime())[0] ?? null
}

function staleSeverity(ageMs: number | null): OverviewSeverity {
  if (ageMs == null) return 'unknown'
  if (ageMs > VERY_STALE_SCRAPE_MS) return 'critical'
  if (ageMs > STALE_SCRAPE_MS) return 'warning'
  return 'good'
}

function queueReadinessLabel(queue: QueueRow): string {
  if (queue.stats.failed > 0) return `${queue.stats.failed} failed`
  if (queue.paused) return 'Paused'
  if (queue.stats.waiting > 0 || queue.stats.active > 0 || queue.stats.delayed > 0) return 'Work pending'
  return 'Ready'
}

function queueReadinessDetail(queue: QueueRow): string {
  return `${queue.stats.waiting} waiting, ${queue.stats.active} active, ${queue.stats.delayed} delayed`
}

function queueReadinessSeverity(queue: QueueRow): OverviewSeverity {
  if (queue.stats.failed > 0) return 'critical'
  if (queue.paused || queue.stats.waiting > 0 || queue.stats.delayed > 0) return 'warning'
  return 'good'
}

function serviceAttention(health: HealthResponse | null, error: string | undefined): AttentionItem[] {
  if (error) {
    return [{ id: 'health-unavailable', title: 'Service health unavailable', detail: error, href: '/status', severity: 'unknown' }]
  }
  if (!health) {
    return [{ id: 'health-loading', title: 'Service health not loaded', detail: 'Waiting for the health endpoint to respond.', href: '/status', severity: 'unknown' }]
  }

  return Object.entries(health.services)
    .filter(([, service]) => service.status !== 'up')
    .map(([name, service]) => ({
      id: `service-${name}`,
      title: `${serviceName(name)} is ${serviceLabel(service).toLowerCase()}`,
      detail: serviceDetail(service),
      href: name === 'valkey' ? '/ops/queues' : '/status',
      severity: service.status === 'down' ? 'critical' : 'warning',
    }))
}

function sourceAttention(remapSources: SourceRow[], erroredSources: SourceRow[], error: string | undefined): AttentionItem[] {
  if (error) return [{ id: 'sources-unavailable', title: 'Source telemetry unavailable', detail: error, href: '/ops/sources', severity: 'unknown' }]
  return [
    ...remapSources.map(source => ({
      id: `source-remap-${source.id}`,
      title: `${source.name} needs remapping`,
      detail: source.errorMessage ?? 'Source HTML changed and selector remapping needs operator review.',
      href: '/ops/sources',
      severity: 'critical' as const,
    })),
    ...erroredSources.map(source => ({
      id: `source-error-${source.id}`,
      title: `${source.name} source is in error`,
      detail: source.errorMessage ?? 'Latest source scrape reported an error.',
      href: '/ops/sources',
      severity: 'critical' as const,
    })),
  ]
}

function queueAttention(failedJobs: number | null, pausedQueues: QueueRow[], error: string | undefined): AttentionItem[] {
  if (error) return [{ id: 'queues-unavailable', title: 'Queue telemetry unavailable', detail: error, href: '/ops/queues', severity: 'unknown' }]
  const items: AttentionItem[] = []
  if (failedJobs && failedJobs > 0) {
    items.push({ id: 'failed-jobs', title: 'Failed jobs need review', detail: `${failedJobs} failed jobs are present across queues.`, href: '/ops/queues', severity: 'critical' })
  }
  if (pausedQueues.length > 0) {
    items.push({ id: 'paused-queues', title: 'Queues are paused', detail: pausedQueues.map(queue => queue.name).join(', '), href: '/ops/queues', severity: 'warning' })
  }
  return items
}

function scheduleAttention(disabledSchedules: ScheduleEntry[], failedSchedules: ScheduleEntry[], error: string | undefined): AttentionItem[] {
  if (error) return [{ id: 'schedules-unavailable', title: 'Schedule telemetry unavailable', detail: error, href: '/ops/schedules', severity: 'unknown' }]
  const items: AttentionItem[] = []
  if (disabledSchedules.length > 0) {
    items.push({ id: 'disabled-schedules', title: 'Schedules are disabled', detail: disabledSchedules.map(schedule => schedule.label).join(', '), href: '/ops/schedules', severity: 'warning' })
  }
  if (failedSchedules.length > 0) {
    items.push({ id: 'failed-schedules', title: 'Scheduled jobs have recent failures', detail: failedSchedules.map(schedule => schedule.label).join(', '), href: '/ops/schedules', severity: 'critical' })
  }
  return items
}

function freshnessAttention(run: RunRow | null, ageMs: number | null, error: string | undefined, now: Date): AttentionItem[] {
  if (error) return [{ id: 'runs-unavailable', title: 'Scraper run telemetry unavailable', detail: error, href: '/ops/runs', severity: 'unknown' }]
  const severity = staleSeverity(ageMs)
  if (severity === 'good') return []
  if (!run) {
    return [{ id: 'no-successful-run', title: 'No successful scraper run found', detail: 'Recent run history does not include a completed successful scrape.', href: '/ops/runs', severity: 'warning' }]
  }
  return [{
    id: 'stale-scraper-run',
    title: 'Listings may be stale',
    detail: `Last successful scrape finished ${formatRelative(run.finishedAt, now)}.`,
    href: '/ops/runs',
    severity: severity === 'critical' ? 'critical' : 'warning',
  }]
}

/**
 * Raises a warning when a source's possibly_gone count is suspiciously large
 * relative to its active listing count. This surface the MobilityWorks / BLVD
 * discrepancy scenario described in issue #514 where source reports 59 active
 * rows while Postgres has 63 active + 219 possibly_gone.
 *
 * Threshold: possibly_gone count exceeds 20% of active listings.
 */
function inventoryDiscrepancyAttention(sources: SourceRow[] | null, error: string | undefined): AttentionItem[] {
  if (error || !sources) return []
  const POSSIBLY_GONE_WARNING_RATIO = 0.2
  return sources
    .filter(source =>
      source.possiblyGoneCount > 0 &&
      source.listingCount > 0 &&
      source.possiblyGoneCount / source.listingCount >= POSSIBLY_GONE_WARNING_RATIO,
    )
    .map(source => ({
      id: `inventory-discrepancy-${source.id}`,
      title: `${source.name} has a high possibly-gone count`,
      detail: `${source.possiblyGoneCount} possibly-gone listing(s) vs ${source.listingCount} active. This may indicate listings removed from the source index but not yet confirmed gone. Run a full crawl to reconcile.`,
      href: '/ops/sources',
      severity: 'warning' as const,
    }))
}

function geocodeAttention(queue: QueueRow | null, error: string | undefined): AttentionItem[] {
  if (error || !queue) return []
  if (queue.stats.failed > 0) {
    return [{ id: 'geocode-failed', title: 'Geocode jobs failed', detail: `${queue.stats.failed} geocode jobs failed; map pins may be incomplete.`, href: '/ops/queues', severity: 'critical' }]
  }
  if (queue.paused) {
    return [{ id: 'geocode-paused', title: 'Geocode queue is paused', detail: 'New listings may not receive map coordinates until this queue resumes.', href: '/ops/queues', severity: 'warning' }]
  }
  return []
}

function overallLabel(severity: OverviewSeverity): string {
  if (severity === 'critical') return 'Attention needed'
  if (severity === 'warning') return 'Watch closely'
  if (severity === 'unknown') return 'Partially observable'
  return 'Operations look healthy'
}

function serviceName(name: string): string {
  if (name === 'postgres') return 'Database'
  if (name === 'meilisearch') return 'Meilisearch'
  if (name === 'valkey') return 'Valkey'
  if (name === 'scraper') return 'Scraper'
  if (name === 'ollama') return 'Ollama'
  return name
}

function formatRelative(value: string | null, now: Date): string {
  if (!value) return 'Not yet tracked'
  const ms = now.getTime() - new Date(value).getTime()
  if (ms < 60_000) return 'less than 1 min ago'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hr ago`
  return `${Math.round(hours / 24)} days ago`
}

function formatDateTime(value: string | null): string {
  if (!value) return 'unknown time'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
