import { describe, expect, it } from 'vitest'
import type { HealthResponse } from '@wivwav/types'
import { buildOpsOverview, type OverviewInput } from './overview-helpers.js'

const NOW = new Date('2026-06-18T18:00:00.000Z')

function healthyHealth(overrides: Partial<HealthResponse['services']> = {}): HealthResponse {
  return {
    status: 'ok',
    timestamp: NOW.toISOString(),
    services: {
      postgres: { status: 'up', latencyMs: 12 },
      meilisearch: { status: 'up', latencyMs: 18 },
      valkey: { status: 'up', latencyMs: 9 },
      scraper: { status: 'up', lastRunAt: '2026-06-18T17:00:00.000Z' },
      ollama: { status: 'optional_offline', message: 'Optional AI remapping is offline' },
      ...overrides,
    },
  }
}

function baseInput(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    now: NOW,
    health: healthyHealth(),
    queues: [
      { name: 'source-scrape', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
      { name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 } },
    ],
    sources: [
      { id: 'src-1', name: 'BLVD.com', status: 'active', lastScrapedAt: '2026-06-18T17:00:00.000Z', listingCount: 12, errorMessage: null, lastFullCrawlAt: null, lastObservedAt: null, possiblyGoneCount: 0 },
      { id: 'src-2', name: 'MobilityWorks', status: 'active', lastScrapedAt: '2026-06-18T16:30:00.000Z', listingCount: 8, errorMessage: null, lastFullCrawlAt: null, lastObservedAt: null, possiblyGoneCount: 0 },
    ],
    runs: [
      { id: 'run-1', sourceId: 'src-1', sourceName: 'BLVD.com', startedAt: '2026-06-18T16:55:00.000Z', finishedAt: '2026-06-18T17:00:00.000Z', success: true, listingsFound: 12, listingsNew: 1, listingsUpdated: 2, errorMessage: null },
    ],
    schedules: [
      { id: 'geocode', queue: 'geocode', label: 'Geocode', enabled: true, lastRunAt: '2026-06-18T08:00:00.000Z', lastStatus: 'completed', recentFailureCount: 0, recentFailureReason: null },
    ],
    errors: {},
    ...overrides,
  }
}

describe('buildOpsOverview', () => {
  it('summarizes healthy available operations data', () => {
    const overview = buildOpsOverview(baseInput({
      health: healthyHealth({ ollama: { status: 'up', latencyMs: 30 } }),
    }))

    expect(overview.overall.label).toBe('Operations look healthy')
    expect(overview.freshnessCards.find(card => card.id === 'active-listings')?.value).toBe('20')
    expect(overview.freshnessCards.find(card => card.id === 'last-successful-scrape')?.value).toBe('1 hr ago')
    expect(overview.healthCards.find(card => card.id === 'queues')?.value).toBe('No failed jobs')
    expect(overview.attention[0]?.id).toBe('no-attention-needed')
    expect(overview.attention[0]?.severity).toBe('good')
  })

  it('raises attention for remaps, failed jobs, disabled schedules, and down services', () => {
    const overview = buildOpsOverview(baseInput({
      health: healthyHealth({
        postgres: { status: 'down' },
        ollama: { status: 'up', latencyMs: 30 },
      }),
      queues: [
        { name: 'source-scrape', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 2, delayed: 0 } },
        { name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 5, failed: 1, delayed: 0 } },
      ],
      sources: [
        { id: 'src-1', name: 'BLVD.com', status: 'needs_remapping', lastScrapedAt: null, listingCount: 0, errorMessage: 'Selector confidence too low', lastFullCrawlAt: null, lastObservedAt: null, possiblyGoneCount: 0 },
      ],
      schedules: [
        { id: 'geocode', queue: 'geocode', label: 'Geocode', enabled: false, lastRunAt: null, lastStatus: null, recentFailureCount: 1, recentFailureReason: 'timeout' },
      ],
    }))

    expect(overview.overall.severity).toBe('critical')
    expect(overview.attention.map(item => item.id)).toEqual(expect.arrayContaining([
      'service-postgres',
      'source-remap-src-1',
      'failed-jobs',
      'disabled-schedules',
      'failed-schedules',
      'geocode-failed',
    ]))
    expect(overview.freshnessCards.find(card => card.id === 'sources-needing-remap')?.value).toBe('1')
    expect(overview.freshnessCards.find(card => card.id === 'geocode-readiness')?.severity).toBe('critical')
  })

  it('shows missing telemetry as unavailable or not yet tracked', () => {
    const overview = buildOpsOverview(baseInput({
      health: null,
      queues: null,
      sources: null,
      runs: null,
      schedules: null,
      errors: { health: 'API returned 503', queues: 'Queue service is unavailable' },
    }))

    expect(overview.overall.severity).toBe('unknown')
    expect(overview.healthCards.find(card => card.id === 'api')?.value).toBe('Unavailable')
    expect(overview.healthCards.find(card => card.id === 'queues')?.detail).toBe('Queue service is unavailable')
    expect(overview.telemetry.map(card => card.value)).toEqual(expect.arrayContaining(['Not yet tracked', 'Unavailable']))
    expect(overview.attention.map(item => item.id)).toEqual(expect.arrayContaining(['health-unavailable', 'queues-unavailable']))
  })

  it('warns when the latest successful scraper run is stale', () => {
    const overview = buildOpsOverview(baseInput({
      health: healthyHealth({ ollama: { status: 'up', latencyMs: 30 } }),
      runs: [
        { id: 'run-old', sourceId: 'src-1', sourceName: 'BLVD.com', startedAt: '2026-06-15T17:55:00.000Z', finishedAt: '2026-06-15T18:00:00.000Z', success: true, listingsFound: 10, listingsNew: 0, listingsUpdated: 1, errorMessage: null },
      ],
    }))

    expect(overview.freshnessCards.find(card => card.id === 'last-successful-scrape')?.severity).toBe('critical')
    expect(overview.attention.map(item => item.id)).toContain('stale-scraper-run')
  })
})
