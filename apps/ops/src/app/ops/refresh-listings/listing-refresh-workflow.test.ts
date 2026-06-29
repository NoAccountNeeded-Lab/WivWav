import { describe, expect, it } from 'vitest'
import {
  buildListingRefreshSteps,
  getActiveSourceIds,
  type ListingRefreshStatus,
  type RefreshQueueState,
  type WorkflowHealth,
} from './listing-refresh-workflow.js'

const queueNames = ['source-scrape', 'detail-crawl', 'detail-extract', 'geocode'] as const

describe('getActiveSourceIds', () => {
  it('returns each non-empty active source id once', () => {
    expect(getActiveSourceIds([
      { id: 'src-1', name: 'One', status: 'active' },
      { id: 'src-2', name: 'Two', status: 'paused' },
      { id: 'src-1', name: 'Duplicate', status: 'active' },
      { id: '  ', name: 'Invalid', status: 'active' },
      { id: ' src-3 ', name: 'Three', status: 'active' },
    ])).toEqual(['src-1', 'src-3'])
  })
})

function makeQueue(overrides: Partial<RefreshQueueState> & Pick<RefreshQueueState, 'name'>): RefreshQueueState {
  return {
    paused: false,
    stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
    lastJobAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    recentFailureCount: 0,
    recentFailureReason: null,
    ...overrides,
  }
}

function makeStatus(overrides: Partial<ListingRefreshStatus> = {}): ListingRefreshStatus {
  return {
    generatedAt: '2026-06-18T10:00:00.000Z',
    sources: {
      total: 2,
      active: 2,
      needsAttention: 0,
      totalListings: 20,
      observedActiveListings: 20,
      eligibleListings: 5,
      lastScrapedAt: '2026-06-18T09:00:00.000Z',
    },
    listings: {
      active: 20,
      observedActive: 20,
      eligible: 5,
      mapReady: 18,
      missingLocations: 2,
    },
    latestScrapeRun: null,
    queues: queueNames.map(name => makeQueue({ name })),
    ...overrides,
  }
}

function makeHealth(overrides: Partial<WorkflowHealth['services']> = {}): WorkflowHealth {
  return {
    services: {
      meilisearch: { status: 'up' },
      valkey: { status: 'up' },
      scraper: { status: 'up' },
      ...overrides,
    },
  }
}

describe('buildListingRefreshSteps', () => {
  it('marks geocoding actionable when active listings are missing locations', () => {
    const steps = buildListingRefreshSteps(makeStatus(), makeHealth())
    const geocode = steps.find(step => step.id === 'geocode')

    expect(geocode?.status).toBe('actionable')
    expect(geocode?.actions[0]?.disabled).toBe(false)
  })

  it('disables geocoding when all active listings already have coordinates', () => {
    const steps = buildListingRefreshSteps(
      makeStatus({
        listings: {
          active: 20,
          observedActive: 20,
          eligible: 5,
          mapReady: 20,
          missingLocations: 0,
        },
      }),
      makeHealth(),
    )
    const geocode = steps.find(step => step.id === 'geocode')

    expect(geocode?.status).toBe('complete')
    expect(geocode?.actions[0]).toMatchObject({
      disabled: true,
      disabledReason: 'All active listings already have map coordinates.',
    })
  })

  it('blocks queue-backed actions when Valkey is down', () => {
    const steps = buildListingRefreshSteps(makeStatus(), makeHealth({ valkey: { status: 'down' } }))

    expect(steps.find(step => step.id === 'scrape')?.actions[0]).toMatchObject({
      disabled: true,
      disabledReason: 'Valkey is unavailable, so jobs cannot be enqueued.',
    })
    expect(steps.find(step => step.id === 'details')?.status).toBe('blocked')
  })

  it('blocks search sync when Meilisearch is down', () => {
    const steps = buildListingRefreshSteps(makeStatus(), makeHealth({ meilisearch: { status: 'down' } }))
    const sync = steps.find(step => step.id === 'sync')

    expect(sync?.status).toBe('blocked')
    expect(sync?.actions[0]).toMatchObject({
      disabled: true,
      disabledReason: 'Meilisearch is unavailable.',
    })
  })

  it('marks processing as running while detail queues have active work', () => {
    const status = makeStatus({
      queues: [
        makeQueue({ name: 'source-scrape' }),
        makeQueue({ name: 'detail-crawl', stats: { waiting: 0, active: 1, completed: 0, failed: 0, delayed: 0 } }),
        makeQueue({ name: 'detail-extract' }),
        makeQueue({ name: 'geocode' }),
      ],
    })

    const details = buildListingRefreshSteps(status, makeHealth()).find(step => step.id === 'details')

    expect(details?.status).toBe('running')
  })

  it('warns before search sync when map locations are still missing', () => {
    const sync = buildListingRefreshSteps(makeStatus(), makeHealth()).find(step => step.id === 'sync')

    expect(sync?.status).toBe('warning')
    expect(sync?.actions[0]?.disabled).toBe(false)
  })

  it('blocks search sync while no listings are eligible', () => {
    const status = makeStatus({
      listings: {
        active: 20,
        observedActive: 20,
        eligible: 0,
        mapReady: 18,
        missingLocations: 2,
      },
    })
    const sync = buildListingRefreshSteps(status, makeHealth()).find(step => step.id === 'sync')

    expect(sync?.status).toBe('blocked')
    expect(sync?.actions[0]).toMatchObject({
      disabled: true,
      disabledReason: 'No listings are eligible for publication.',
    })
  })
})
