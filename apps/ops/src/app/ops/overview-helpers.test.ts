import { describe, expect, it } from 'vitest'
import type { HealthResponse } from '@wivwav/types'
import { buildOpsOverview, isSettledEmpty, toAttentionResourceInput, type OverviewInput } from './overview-helpers.js'

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
    listingRefresh: {
      generatedAt: '2026-06-18T17:00:00.000Z',
      sources: { total: 2, active: 2, needsAttention: 0, totalListings: 20, observedActiveListings: 20, eligibleListings: 20, lastScrapedAt: '2026-06-18T17:00:00.000Z' },
      listings: { active: 20, observedActive: 20, eligible: 20, mapReady: 18, missingLocations: 2 },
      latestScrapeRun: null,
      queues: [],
    },
    problemCounts: { critical: 0, warning: 0 },
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
    expect(overview.freshnessCards.find(card => card.id === 'last-successful-scrape')?.value).toBe('1 hour ago')
    expect(overview.healthCards.find(card => card.id === 'queues')?.value).toBe('No failed jobs')
    expect(overview.attention[0]?.id).toBe('no-attention-needed')
    expect(overview.attention[0]?.severity).toBe('good')
  })

  it('factors unacknowledged problem counts (issue #892) into the overall severity/detail', () => {
    const overview = buildOpsOverview(baseInput({
      problemCounts: { critical: 2, warning: 1 },
    }))

    expect(overview.overall.severity).toBe('critical')
    expect(overview.overall.label).toBe('Attention needed')
    expect(overview.overall.detail).toBe('2 critical, 1 warning, 0 unavailable signals')
    // This module itself no longer recomputes domain conditions as attention
    // items — that federation now lives entirely behind the shared
    // problem-aggregate call (issue #890/#892).
    expect(overview.attention[0]?.id).toBe('no-attention-needed')
  })

  it('shows missing telemetry as unavailable or not yet tracked', () => {
    const overview = buildOpsOverview(baseInput({
      health: null,
      queues: null,
      sources: null,
      runs: null,
      schedules: null,
      listingRefresh: null,
      problemCounts: null,
      errors: { health: 'API returned 503', queues: 'Queue service is unavailable' },
    }))

    expect(overview.overall.severity).toBe('unknown')
    expect(overview.healthCards.find(card => card.id === 'api')?.value).toBe('Unavailable')
    expect(overview.healthCards.find(card => card.id === 'queues')?.detail).toBe('Queue service is unavailable')
    expect(overview.telemetry.find(card => card.id === 'missing-coordinates')?.value).toBe('Unavailable')
    expect(overview.telemetry.find(card => card.id === 'missing-coordinates')?.severity).toBe('unknown')
    expect(overview.telemetry.map(card => card.value)).toEqual(expect.arrayContaining(['Not yet tracked', 'Unavailable']))
    expect(overview.attention.map(item => item.id)).toEqual(expect.arrayContaining(['health-unavailable', 'queues-unavailable']))
  })

  it('surfaces a listing-refresh fetch failure as an attention item, matching the other five resources', () => {
    const overview = buildOpsOverview(baseInput({
      errors: { listingRefresh: 'Listing-refresh service is unavailable' },
    }))

    const card = overview.telemetry.find(c => c.id === 'missing-coordinates')
    expect(card?.value).toBe('Unavailable')
    expect(card?.severity).toBe('unknown')
    expect(card?.detail).toBe('Listing-refresh service is unavailable')
    expect(overview.attention.map(item => item.id)).toContain('listing-refresh-unavailable')
  })

  it('shows the missing-coordinates tile as not yet loaded while its resource is still pending', () => {
    const overview = buildOpsOverview(baseInput({
      listingRefresh: null,
      pending: { listingRefresh: true },
    }))

    const card = overview.telemetry.find(c => c.id === 'missing-coordinates')
    expect(card?.value).toBe('Not yet tracked')
    expect(card?.severity).toBe('unknown')
  })

  it('surfaces the live missing-coordinates count with warning severity when nonzero', () => {
    const overview = buildOpsOverview(baseInput({
      listingRefresh: {
        generatedAt: '2026-06-18T17:00:00.000Z',
        sources: { total: 2, active: 2, needsAttention: 0, totalListings: 20, observedActiveListings: 20, eligibleListings: 20, lastScrapedAt: '2026-06-18T17:00:00.000Z' },
        listings: { active: 20, observedActive: 20, eligible: 20, mapReady: 15, missingLocations: 5 },
        latestScrapeRun: null,
        queues: [],
      },
    }))

    const card = overview.telemetry.find(c => c.id === 'missing-coordinates')
    expect(card?.value).toBe('5')
    expect(card?.severity).toBe('warning')
  })

  it('shows a healthy state when the missing-coordinates count is zero', () => {
    const overview = buildOpsOverview(baseInput({
      listingRefresh: {
        generatedAt: '2026-06-18T17:00:00.000Z',
        sources: { total: 2, active: 2, needsAttention: 0, totalListings: 20, observedActiveListings: 20, eligibleListings: 20, lastScrapedAt: '2026-06-18T17:00:00.000Z' },
        listings: { active: 20, observedActive: 20, eligible: 20, mapReady: 20, missingLocations: 0 },
        latestScrapeRun: null,
        queues: [],
      },
    }))

    const card = overview.telemetry.find(c => c.id === 'missing-coordinates')
    expect(card?.value).toBe('0')
    expect(card?.severity).toBe('good')
  })

  it('warns when the latest successful scraper run is stale', () => {
    const overview = buildOpsOverview(baseInput({
      health: healthyHealth({ ollama: { status: 'up', latencyMs: 30 } }),
      runs: [
        { id: 'run-old', sourceId: 'src-1', sourceName: 'BLVD.com', startedAt: '2026-06-15T17:55:00.000Z', finishedAt: '2026-06-15T18:00:00.000Z', success: true, listingsFound: 10, listingsNew: 0, listingsUpdated: 1, errorMessage: null },
      ],
    }))

    expect(overview.freshnessCards.find(card => card.id === 'last-successful-scrape')?.severity).toBe('critical')
  })
})

describe('isSettledEmpty', () => {
  it('is true only once a resource has settled with no data and no pending flag', () => {
    expect(isSettledEmpty(null, false)).toBe(true)
    expect(isSettledEmpty(null, true)).toBe(false)
    expect(isSettledEmpty({}, false)).toBe(false)
  })
})

describe('toAttentionResourceInput', () => {
  it('reports unavailable when the resource has an error', () => {
    const result = toAttentionResourceInput({ data: null, error: 'boom', isLoading: false, isRefreshing: false, updatedAt: null, retry: () => {}, setData: () => {} })
    expect(result).toEqual({ data: null, unavailable: true })
  })

  it('reports available (not unavailable) while a resource is still loading', () => {
    const result = toAttentionResourceInput({ data: null, error: null, isLoading: true, isRefreshing: false, updatedAt: null, retry: () => {}, setData: () => {} })
    expect(result).toEqual({ data: null, unavailable: false })
  })

  it('passes through real data unmodified', () => {
    const result = toAttentionResourceInput({ data: [1, 2, 3], error: null, isLoading: false, isRefreshing: false, updatedAt: new Date(), retry: () => {}, setData: () => {} })
    expect(result).toEqual({ data: [1, 2, 3], unavailable: false })
  })
})
