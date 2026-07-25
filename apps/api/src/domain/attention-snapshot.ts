import type {
  AttentionCondition,
  AttentionQueueSignal,
  AttentionResourceInput,
  AttentionRunSignal,
  AttentionScheduleSignal,
  AttentionSignalAvailability,
  AttentionSnapshot,
  AttentionSnapshotRequest,
  AttentionSourceSignal,
  HealthResponse,
} from '@wivwav/types'

/**
 * Single domain-level "what is currently wrong" computation (issue #774, D4
 * from #757/#758). Ports the condition logic previously duplicated in
 * `apps/ops/src/app/ops/overview-helpers.ts` into a pure, presentation-free
 * function so it can be shared by the ops overview's Attention panel today
 * and the diagnostic gateway's `get_system_snapshot` in a follow-up issue.
 *
 * This function never fetches anything — callers report each resource's
 * already-known state via `AttentionResourceInput`. It never throws: a
 * resource marked `unavailable` simply contributes no conditions and is
 * reflected in `signalAvailability` instead.
 */

// Keep in sync with the "Last successful scrape"/"stale" thresholds duplicated
// for presentation purposes in apps/ops/src/app/ops/overview-helpers.ts.
const STALE_SCRAPE_MS = 24 * 60 * 60 * 1000
const VERY_STALE_SCRAPE_MS = 48 * 60 * 60 * 1000

/** Fraction of active listings a source's possibly-gone count may reach
 *  before it is flagged as a likely index-absence discrepancy (issue #514). */
const POSSIBLY_GONE_WARNING_RATIO = 0.2

export function computeAttentionSnapshot(request: AttentionSnapshotRequest): AttentionSnapshot {
  // A resource marked `unavailable` contributes no conditions even if it
  // still carries a stale `data` value (e.g. `usePolledResource` keeps the
  // last-known-good value across a failed poll) — otherwise this would
  // surface conditions computed from data the caller has explicitly told us
  // not to trust, while `signalAvailability` simultaneously reports that
  // same backend as unreachable.
  const health = request.health.unavailable ? null : request.health.data
  const sources = request.sources.unavailable ? null : request.sources.data
  const queues = request.queues.unavailable ? null : request.queues.data
  const schedules = request.schedules.unavailable ? null : request.schedules.data
  const runs = request.runs.unavailable ? null : request.runs.data

  const conditions: AttentionCondition[] = [
    ...healthConditions(health),
    ...sourceConditions(sources),
    ...queueConditions(queues),
    ...scheduleConditions(schedules),
    ...freshnessConditions(runs, request.now),
    ...geocodeConditions(queues),
  ]

  return {
    conditions,
    signalAvailability: computeSignalAvailability(request),
  }
}

function computeSignalAvailability(request: AttentionSnapshotRequest): AttentionSignalAvailability {
  // `db` covers sources, runs, and schedules — all Postgres-backed reads.
  // Any one of them reporting unavailable means the resulting condition set
  // is incomplete, so the signal as a whole is reported unavailable.
  const dbUnavailable = request.sources.unavailable || request.runs.unavailable || request.schedules.unavailable

  return {
    health: request.health.unavailable ? 'unavailable' : 'available',
    bullmq: request.queues.unavailable ? 'unavailable' : 'available',
    db: dbUnavailable ? 'unavailable' : 'available',
    // Optional — only the diagnostic gateway's `get_system_snapshot` (#775)
    // actually probes Loki and reports it. Every other caller omits `loki`
    // entirely, which this treats identically to the hardcoded 'available'
    // this field replaced, so their existing behaviour/tests are unchanged.
    loki: request.loki?.unavailable ? 'unavailable' : 'available',
  }
}

function healthConditions(health: HealthResponse | null): AttentionCondition[] {
  if (!health) return []

  return Object.entries(health.services)
    .filter(([, service]) => service.status !== 'up')
    .map(([name, service]) => ({
      code: 'service_unhealthy',
      severity: service.status === 'down' ? 'critical' : 'warning',
      evidenceId: `service:${name}`,
      detail: service.message
        ?? (service.lastRunAt ? `Last successful run at ${service.lastRunAt}` : undefined)
        ?? (service.latencyMs != null ? `${service.latencyMs} ms response` : undefined)
        ?? 'No diagnostic detail returned — check service logs',
    }))
}

function sourceConditions(sources: AttentionSourceSignal[] | null): AttentionCondition[] {
  if (!sources) return []

  const conditions: AttentionCondition[] = []

  for (const source of sources) {
    if (source.status === 'needs_remapping') {
      conditions.push({
        code: 'source_needs_remap',
        severity: 'critical',
        evidenceId: `source:${source.id}`,
        detail: source.errorMessage ?? 'Source HTML changed and selector remapping needs operator review.',
      })
    } else if (source.status === 'error') {
      conditions.push({
        code: 'source_error',
        severity: 'critical',
        evidenceId: `source:${source.id}`,
        detail: source.errorMessage ?? 'Latest source scrape reported an error.',
      })
    }

    if (source.possiblyGoneCount > 0 && source.listingCount > 0 && source.possiblyGoneCount / source.listingCount >= POSSIBLY_GONE_WARNING_RATIO) {
      conditions.push({
        code: 'source_inventory_discrepancy',
        severity: 'warning',
        evidenceId: `source:${source.id}`,
        detail: `${source.possiblyGoneCount} possibly-gone listing(s) vs ${source.listingCount} active. This may indicate listings removed from the source index but not yet confirmed gone. Run a full crawl to reconcile.`,
      })
    }
  }

  return conditions
}

function queueConditions(queues: AttentionQueueSignal[] | null): AttentionCondition[] {
  if (!queues) return []

  const conditions: AttentionCondition[] = []
  const failedJobs = queues.reduce((sum, queue) => sum + queue.stats.failed, 0)
  const pausedQueues = queues.filter(queue => queue.paused)

  if (failedJobs > 0) {
    conditions.push({
      code: 'queue_failed_jobs',
      severity: 'critical',
      evidenceId: 'queue:*',
      detail: `${failedJobs} failed jobs are present across queues.`,
    })
  }
  if (pausedQueues.length > 0) {
    conditions.push({
      code: 'queue_paused',
      severity: 'warning',
      evidenceId: 'queue:*',
      detail: pausedQueues.map(queue => queue.name).join(', '),
    })
  }

  return conditions
}

function scheduleConditions(schedules: AttentionScheduleSignal[] | null): AttentionCondition[] {
  if (!schedules) return []

  const conditions: AttentionCondition[] = []
  const disabledSchedules = schedules.filter(schedule => !schedule.enabled)
  const failedSchedules = schedules.filter(schedule => schedule.recentFailureCount > 0)

  if (disabledSchedules.length > 0) {
    conditions.push({
      code: 'schedule_disabled',
      severity: 'warning',
      evidenceId: 'schedule:*',
      detail: disabledSchedules.map(schedule => schedule.label).join(', '),
    })
  }
  if (failedSchedules.length > 0) {
    conditions.push({
      code: 'schedule_failed',
      severity: 'critical',
      evidenceId: 'schedule:*',
      detail: failedSchedules.map(schedule => schedule.label).join(', '),
    })
  }

  return conditions
}

function freshnessConditions(runs: AttentionRunSignal[] | null, now: string): AttentionCondition[] {
  if (!runs) return []

  const lastSuccessfulRun = runs
    .filter(run => run.success === true && run.finishedAt)
    .sort((a, b) => new Date(b.finishedAt ?? 0).getTime() - new Date(a.finishedAt ?? 0).getTime())[0] ?? null

  const ageMs = lastSuccessfulRun?.finishedAt ? new Date(now).getTime() - new Date(lastSuccessfulRun.finishedAt).getTime() : null

  if (ageMs == null) {
    return [{
      code: 'scraper_no_successful_run',
      severity: 'warning',
      evidenceId: 'run:none',
      detail: 'Recent run history does not include a completed successful scrape.',
    }]
  }

  if (ageMs <= STALE_SCRAPE_MS) return []

  return [{
    code: 'scraper_stale_run',
    severity: ageMs > VERY_STALE_SCRAPE_MS ? 'critical' : 'warning',
    evidenceId: `run:${lastSuccessfulRun?.id ?? 'unknown'}`,
    detail: `Last successful scrape finished at ${lastSuccessfulRun?.finishedAt ?? 'an unknown time'}.`,
  }]
}

function geocodeConditions(queues: AttentionQueueSignal[] | null): AttentionCondition[] {
  const geocodeQueue = queues?.find(queue => queue.name === 'geocode') ?? null
  if (!geocodeQueue) return []

  if (geocodeQueue.stats.failed > 0) {
    return [{
      code: 'geocode_failed',
      severity: 'critical',
      evidenceId: 'queue:geocode',
      detail: `${geocodeQueue.stats.failed} geocode jobs failed; map pins may be incomplete.`,
    }]
  }
  if (geocodeQueue.paused) {
    return [{
      code: 'geocode_paused',
      severity: 'warning',
      evidenceId: 'queue:geocode',
      detail: 'New listings may not receive map coordinates until this queue resumes.',
    }]
  }

  return []
}

// Re-exported so route handlers can validate an incoming request shape
// against the exact input type this computation expects.
export type { AttentionResourceInput }
