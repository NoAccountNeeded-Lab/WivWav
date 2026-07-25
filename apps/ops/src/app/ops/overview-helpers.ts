import { formatAbsoluteTimestamp, formatRelativeTimestamp } from '@/lib/relative-time'
import type { AttentionResourceInput, HealthResponse, ServiceHealth } from '@wivwav/types'
import type { PolledResourceState } from '@/lib/use-polled-resource'
import type { ListingRefreshStatus } from './refresh-listings/listing-refresh-workflow'

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
  title?: string
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

export type OverviewResourceKey = 'health' | 'queues' | 'sources' | 'runs' | 'schedules' | 'listingRefresh'

export interface OverviewInput {
  health: HealthResponse | null
  queues: QueueRow[] | null
  sources: SourceRow[] | null
  runs: RunRow[] | null
  schedules: ScheduleEntry[] | null
  /**
   * Listing-refresh status aggregate (`GET /admin/listing-refresh/status`) —
   * consumed here for `listings.missingLocations`, which feeds the
   * `missing-coordinates` telemetry tile (issue #927).
   */
  listingRefresh: ListingRefreshStatus | null
  /**
   * Unacknowledged-problem counts by severity from the shared problem
   * aggregate (issue #892, `useProblemAggregate`) — factored into
   * `overall.severity` alongside the telemetry-unavailable items below so
   * the header still reflects real active problems now that this module no
   * longer recomputes domain conditions itself. `null` while the aggregate
   * hasn't resolved yet.
   */
  problemCounts: { critical: number; warning: number } | null
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
  const sourcesNeedingRemap = input.sources?.filter(source => source.status === 'needs_remapping') ?? []
  const lastSuccessfulRun = findLastSuccessfulRun(input.runs)
  const lastScrapeAgeMs = lastSuccessfulRun?.finishedAt ? input.now.getTime() - new Date(lastSuccessfulRun.finishedAt).getTime() : null
  const lastSuccessfulRunRelative = lastSuccessfulRun?.finishedAt ? formatRelativeTimestamp(lastSuccessfulRun.finishedAt, { now: input.now }) : null
  const lastSuccessfulRunTitle = lastSuccessfulRun?.finishedAt ? formatAbsoluteTimestamp(lastSuccessfulRun.finishedAt) : null
  const geocodeQueue = input.queues?.find(queue => queue.name === 'geocode') ?? null
  const healthServices = input.health?.services
  const missingLocations = input.listingRefresh?.listings.missingLocations ?? null

  const healthError = input.errors.health ?? (isSettledEmpty(input.health, input.pending?.health) ? 'Service health telemetry unavailable' : undefined)
  const queueError = input.errors.queues ?? (isSettledEmpty(input.queues, input.pending?.queues) ? 'Queue telemetry unavailable' : undefined)
  const sourceError = input.errors.sources ?? (isSettledEmpty(input.sources, input.pending?.sources) ? 'Source telemetry unavailable' : undefined)
  const runError = input.errors.runs ?? (isSettledEmpty(input.runs, input.pending?.runs) ? 'Scraper run telemetry unavailable' : undefined)
  const scheduleError = input.errors.schedules ?? (isSettledEmpty(input.schedules, input.pending?.schedules) ? 'Schedule telemetry unavailable' : undefined)
  const listingRefreshError = input.errors.listingRefresh ?? (isSettledEmpty(input.listingRefresh, input.pending?.listingRefresh) ? 'Listing-refresh telemetry unavailable' : undefined)

  // Telemetry-fetch-failure signals only — real domain/Grafana/Sentry
  // problems are federated server-side by `computeProblemAggregate` (issue
  // #890) and rendered from the shared `useProblemAggregate` hook (#892),
  // not recomputed here. This keeps a single computation for "what is
  // currently wrong" while this module keeps its narrower "is ops's own
  // telemetry reachable" concern.
  const attention: AttentionItem[] = [
    ...healthUnavailableAttention(input.health, healthError),
    ...unavailableAttention('sources-unavailable', 'Source telemetry unavailable', '/ops/sources', sourceError),
    ...unavailableAttention('queues-unavailable', 'Queue telemetry unavailable', '/ops/queues', queueError),
    ...unavailableAttention('schedules-unavailable', 'Schedule telemetry unavailable', '/ops/schedules', scheduleError),
    ...unavailableAttention('runs-unavailable', 'Scraper run telemetry unavailable', '/ops/runs', runError),
    ...unavailableAttention('listing-refresh-unavailable', 'Listing-refresh telemetry unavailable', '/ops/queues', listingRefreshError),
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
      value: runError ? 'Unavailable' : lastSuccessfulRunRelative ?? 'Not yet tracked',
      detail: runError ?? (lastSuccessfulRun ? `${lastSuccessfulRun.sourceName ?? 'Unknown source'} finished most recently` : 'No successful scraper run found in recent history'),
      severity: runError ? 'unknown' : staleSeverity(lastScrapeAgeMs),
      href: '/ops/runs',
      ...(lastSuccessfulRunTitle ? { title: lastSuccessfulRunTitle } : {}),
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
      value: listingRefreshError ? 'Unavailable' : missingLocations == null ? 'Not yet tracked' : missingLocations.toLocaleString(),
      detail: listingRefreshError ?? (missingLocations == null
        ? 'Listing-refresh telemetry has not loaded yet'
        : missingLocations > 0
          ? `${missingLocations.toLocaleString()} active listings need geocoding`
          : 'All active listings have map coordinates'),
      severity: listingRefreshError ? 'unknown' : missingLocations == null ? 'unknown' : missingLocations > 0 ? 'warning' : 'good',
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

  const criticalCount = attention.filter(item => item.severity === 'critical').length + (input.problemCounts?.critical ?? 0)
  const warningCount = attention.filter(item => item.severity === 'warning').length + (input.problemCounts?.warning ?? 0)
  const unavailableCount = [...healthCards, ...freshnessCards].filter(card => card.severity === 'unknown').length
  const overallSeverity: OverviewSeverity = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : unavailableCount > 0 ? 'unknown' : 'good'
  const hasSignal = attention.length > 0 || criticalCount > 0 || warningCount > 0

  return {
    overall: {
      severity: overallSeverity,
      label: overallLabel(overallSeverity),
      detail: hasSignal
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

export function serviceLabel(health: ServiceHealth | null | undefined): string {
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

/** Short status word for an `OverviewSeverity` (`good`/`warning`/
 *  `critical`/`unknown`) — shared by any `/ops` surface that needs a plain
 *  label for a card's severity, so callers don't each reimplement this
 *  four-way mapping (e.g. the dashboard-grid comparison route's panels,
 *  #912). Distinct from `overallLabel` below, which produces the longer
 *  system-wide banner phrasing, not a per-card status word. */
export function severityStatusLabel(severity: OverviewSeverity): string {
  if (severity === 'good') return 'Healthy'
  if (severity === 'warning') return 'Warning'
  if (severity === 'critical') return 'Critical'
  return 'Unknown'
}

export function serviceDetail(health: ServiceHealth | null | undefined): string {
  if (!health) return 'Waiting for API data'
  if (health.message) return health.message
  if (health.lastRunAt) return `Last successful run ${formatRelativeTimestamp(health.lastRunAt) ?? 'unknown time'}`
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

/**
 * True once a resource has settled with no data and no explicit error —
 * i.e. it is neither still loading nor holding a real value. Shared between
 * the per-resource error defaulting below and `OpsOverviewClient`'s
 * `toAttentionResourceInput` (which reports the same "unavailable" concept
 * to the attention-snapshot endpoint) so the two can't drift apart into
 * disagreeing about whether a resource has genuinely failed.
 */
export function isSettledEmpty(data: unknown, pending: boolean | undefined): boolean {
  return data === null && !pending
}

/** Reports a polled resource's already-known state in the shape the shared
 *  domain computation expects (issue #774) — `unavailable` mirrors the same
 *  "settled with no data and no explicit error" rule this module otherwise
 *  applies per-resource, so callers never disagree about whether a resource
 *  has genuinely failed vs. simply not loaded yet. Shared by
 *  `use-problem-aggregate.ts` (issue #892) and any future caller of
 *  `POST /admin/attention-snapshot`-shaped endpoints. */
export function toAttentionResourceInput<T>(resource: PolledResourceState<T>): AttentionResourceInput<T> {
  return {
    data: resource.data,
    unavailable: Boolean(resource.error) || isSettledEmpty(resource.data, resource.isLoading),
  }
}

function healthUnavailableAttention(health: HealthResponse | null, error: string | undefined): AttentionItem[] {
  if (error) {
    return [{ id: 'health-unavailable', title: 'Service health unavailable', detail: error, href: '/status', severity: 'unknown' }]
  }
  if (!health) {
    return [{ id: 'health-loading', title: 'Service health not loaded', detail: 'Waiting for the health endpoint to respond.', href: '/status', severity: 'unknown' }]
  }
  return []
}

function unavailableAttention(id: string, title: string, href: string, error: string | undefined): AttentionItem[] {
  return error ? [{ id, title, detail: error, href, severity: 'unknown' }] : []
}

function overallLabel(severity: OverviewSeverity): string {
  if (severity === 'critical') return 'Attention needed'
  if (severity === 'warning') return 'Watch closely'
  if (severity === 'unknown') return 'Partially observable'
  return 'Operations look healthy'
}

export function serviceName(name: string): string {
  if (name === 'postgres') return 'Database'
  if (name === 'meilisearch') return 'Meilisearch'
  if (name === 'valkey') return 'Valkey'
  if (name === 'scraper') return 'Scraper'
  if (name === 'ollama') return 'Ollama'
  return name
}
