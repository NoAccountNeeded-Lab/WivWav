import { describe, expect, it } from 'vitest'
import type { AttentionSnapshotRequest, HealthResponse } from '@wivwav/types'
import { computeAttentionSnapshot } from './attention-snapshot.js'

const NOW = '2026-06-18T18:00:00.000Z'

function healthyHealth(): HealthResponse {
  return {
    status: 'ok',
    timestamp: NOW,
    services: {
      postgres: { status: 'up', latencyMs: 12 },
      meilisearch: { status: 'up', latencyMs: 18 },
      valkey: { status: 'up', latencyMs: 9 },
      scraper: { status: 'up', lastRunAt: '2026-06-18T17:00:00.000Z' },
      ollama: { status: 'up', latencyMs: 30 },
    },
  }
}

function baseRequest(overrides: Partial<AttentionSnapshotRequest> = {}): AttentionSnapshotRequest {
  return {
    now: NOW,
    health: { data: healthyHealth(), unavailable: false },
    queues: {
      data: [
        { name: 'source-scrape', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
        { name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 } },
      ],
      unavailable: false,
    },
    sources: {
      data: [
        { id: 'src-1', name: 'BLVD.com', status: 'active', errorMessage: null, listingCount: 12, possiblyGoneCount: 0 },
      ],
      unavailable: false,
    },
    runs: {
      data: [
        { id: 'run-1', sourceId: 'src-1', finishedAt: '2026-06-18T17:00:00.000Z', success: true },
      ],
      unavailable: false,
    },
    schedules: {
      data: [
        { id: 'geocode', label: 'Geocode', enabled: true, recentFailureCount: 0 },
      ],
      unavailable: false,
    },
    ...overrides,
  }
}

describe('computeAttentionSnapshot', () => {
  it('reports no conditions and all signals available for healthy input', () => {
    const snapshot = computeAttentionSnapshot(baseRequest())

    expect(snapshot.conditions).toEqual([])
    expect(snapshot.signalAvailability).toEqual({ health: 'available', bullmq: 'available', db: 'available', loki: 'available' })
  })

  it('raises a critical condition for a down service and a warning for a degraded one', () => {
    const snapshot = computeAttentionSnapshot(baseRequest({
      health: {
        data: { ...healthyHealth(), services: { ...healthyHealth().services, postgres: { status: 'down', message: 'connection refused' }, valkey: { status: 'degraded', latencyMs: 500 } } },
        unavailable: false,
      },
    }))

    expect(snapshot.conditions).toEqual(expect.arrayContaining([
      { code: 'service_unhealthy', severity: 'critical', evidenceId: 'service:postgres', detail: 'connection refused' },
      { code: 'service_unhealthy', severity: 'warning', evidenceId: 'service:valkey', detail: '500 ms response' },
    ]))
  })

  it('raises source conditions with a stable per-source evidenceId', () => {
    const snapshot = computeAttentionSnapshot(baseRequest({
      sources: {
        data: [
          { id: 'src-1', name: 'BLVD.com', status: 'needs_remapping', errorMessage: 'Selector confidence too low', listingCount: 0, possiblyGoneCount: 0 },
          { id: 'src-2', name: 'MobilityWorks', status: 'error', errorMessage: null, listingCount: 10, possiblyGoneCount: 0 },
        ],
        unavailable: false,
      },
    }))

    expect(snapshot.conditions).toEqual(expect.arrayContaining([
      { code: 'source_needs_remap', severity: 'critical', evidenceId: 'source:src-1', detail: 'Selector confidence too low' },
      { code: 'source_error', severity: 'critical', evidenceId: 'source:src-2', detail: 'Latest source scrape reported an error.' },
    ]))
  })

  it('flags a high possibly-gone ratio as an inventory discrepancy', () => {
    const snapshot = computeAttentionSnapshot(baseRequest({
      sources: {
        data: [{ id: 'src-1', name: 'BLVD.com', status: 'active', errorMessage: null, listingCount: 63, possiblyGoneCount: 219 }],
        unavailable: false,
      },
    }))

    expect(snapshot.conditions).toEqual([
      expect.objectContaining({ code: 'source_inventory_discrepancy', severity: 'warning', evidenceId: 'source:src-1' }),
    ])
  })

  it('raises queue and geocode conditions for failed and paused jobs', () => {
    const snapshot = computeAttentionSnapshot(baseRequest({
      queues: {
        data: [
          { name: 'source-scrape', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 2, delayed: 0 } },
          { name: 'geocode', paused: true, stats: { waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 } },
        ],
        unavailable: false,
      },
    }))

    expect(snapshot.conditions).toEqual(expect.arrayContaining([
      { code: 'queue_failed_jobs', severity: 'critical', evidenceId: 'queue:*', detail: '2 failed jobs are present across queues.' },
      { code: 'geocode_paused', severity: 'warning', evidenceId: 'queue:geocode', detail: 'New listings may not receive map coordinates until this queue resumes.' },
    ]))
  })

  it('raises schedule conditions for disabled and failing schedules', () => {
    const snapshot = computeAttentionSnapshot(baseRequest({
      schedules: {
        data: [{ id: 'geocode', label: 'Geocode', enabled: false, recentFailureCount: 2 }],
        unavailable: false,
      },
    }))

    expect(snapshot.conditions).toEqual(expect.arrayContaining([
      { code: 'schedule_disabled', severity: 'warning', evidenceId: 'schedule:*', detail: 'Geocode' },
      { code: 'schedule_failed', severity: 'critical', evidenceId: 'schedule:*', detail: 'Geocode' },
    ]))
  })

  it('raises a warning when there is no successful run on record', () => {
    const snapshot = computeAttentionSnapshot(baseRequest({ runs: { data: [], unavailable: false } }))

    expect(snapshot.conditions).toEqual([
      { code: 'scraper_no_successful_run', severity: 'warning', evidenceId: 'run:none', detail: 'Recent run history does not include a completed successful scrape.' },
    ])
  })

  it('escalates a stale run from warning to critical as it ages further', () => {
    const warning = computeAttentionSnapshot(baseRequest({
      runs: { data: [{ id: 'run-1', sourceId: 'src-1', finishedAt: '2026-06-17T12:00:00.000Z', success: true }], unavailable: false },
    }))
    const critical = computeAttentionSnapshot(baseRequest({
      runs: { data: [{ id: 'run-1', sourceId: 'src-1', finishedAt: '2026-06-16T12:00:00.000Z', success: true }], unavailable: false },
    }))

    expect(warning.conditions).toEqual([expect.objectContaining({ code: 'scraper_stale_run', severity: 'warning', evidenceId: 'run:run-1' })])
    expect(critical.conditions).toEqual([expect.objectContaining({ code: 'scraper_stale_run', severity: 'critical', evidenceId: 'run:run-1' })])
  })

  it('reports each backend unavailable independently without failing the computation', () => {
    const healthDown = computeAttentionSnapshot(baseRequest({ health: { data: null, unavailable: true } }))
    expect(healthDown.signalAvailability).toEqual({ health: 'unavailable', bullmq: 'available', db: 'available', loki: 'available' })
    expect(healthDown.conditions).toEqual([])

    const bullmqDown = computeAttentionSnapshot(baseRequest({ queues: { data: null, unavailable: true } }))
    expect(bullmqDown.signalAvailability).toEqual({ health: 'available', bullmq: 'unavailable', db: 'available', loki: 'available' })

    const dbDown = computeAttentionSnapshot(baseRequest({ sources: { data: null, unavailable: true } }))
    expect(dbDown.signalAvailability).toEqual({ health: 'available', bullmq: 'available', db: 'unavailable', loki: 'available' })

    const dbDownViaRuns = computeAttentionSnapshot(baseRequest({ runs: { data: null, unavailable: true } }))
    expect(dbDownViaRuns.signalAvailability.db).toBe('unavailable')

    const dbDownViaSchedules = computeAttentionSnapshot(baseRequest({ schedules: { data: null, unavailable: true } }))
    expect(dbDownViaSchedules.signalAvailability.db).toBe('unavailable')
  })

  it('does not treat a not-yet-loaded resource as unavailable', () => {
    const snapshot = computeAttentionSnapshot(baseRequest({ sources: { data: null, unavailable: false } }))

    expect(snapshot.signalAvailability.db).toBe('available')
    expect(snapshot.conditions.some(c => c.code.startsWith('source_'))).toBe(false)
  })

  it('ignores stale data on a resource the caller has marked unavailable', () => {
    // A caller (e.g. usePolledResource) may keep the last-known-good `data`
    // across a failed poll and report it alongside `unavailable: true`. The
    // computation must not derive conditions from that stale data — doing so
    // would contradict `signalAvailability` reporting the same backend
    // unreachable in the same response.
    const staleSources = [
      { id: 'src-1', name: 'BLVD.com', status: 'needs_remapping', errorMessage: 'stale error', listingCount: 0, possiblyGoneCount: 0 },
    ]
    const snapshot = computeAttentionSnapshot(baseRequest({
      sources: { data: staleSources, unavailable: true },
    }))

    expect(snapshot.signalAvailability.db).toBe('unavailable')
    expect(snapshot.conditions).toEqual([])
  })
})
