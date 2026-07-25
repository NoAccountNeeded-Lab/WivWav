// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardGridClient } from './DashboardGridClient'
import { clearWarmCache } from '@/lib/warm-data-cache'

const HEALTH_BODY = {
  data: {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      postgres: { status: 'up' },
      meilisearch: { status: 'up' },
      valkey: { status: 'down', message: 'connection refused' },
      ollama: { status: 'up' },
      scraper: { status: 'up' },
    },
  },
}

const QUEUES_BODY = {
  data: [{ name: 'source-scrape', paused: false, stats: { waiting: 2, active: 1, completed: 10, failed: 3, delayed: 0 } }],
}
const SOURCES_BODY = {
  data: [{
    id: 'src-1', name: 'BLVD', status: 'ok', lastScrapedAt: new Date().toISOString(),
    lastFullCrawlAt: new Date().toISOString(), lastObservedAt: new Date().toISOString(),
    listingCount: 42, errorMessage: null, possiblyGoneCount: 0,
  }],
}
const RUNS_BODY = {
  data: [{
    id: 'run-1', sourceId: 'src-1', sourceName: 'BLVD',
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    success: true, listingsFound: 10, listingsNew: 2, listingsUpdated: 1, errorMessage: null,
  }],
}
const SCHEDULES_BODY = {
  data: [{
    id: 'sched-1', queue: 'source-scrape', label: 'Nightly scrape', enabled: true,
    lastRunAt: new Date().toISOString(), lastStatus: 'completed', recentFailureCount: 0, recentFailureReason: null,
  }],
}
const PROBLEM_AGGREGATE_BODY = {
  data: {
    problems: [{
      fingerprint: 'domain:service_unhealthy:service:valkey',
      source: 'domain', severity: 'critical', detail: 'Valkey is unreachable',
      evidenceId: 'service:valkey', href: null, firstSeen: null, lastSeen: new Date().toISOString(),
      occurrenceCount: null, acknowledgedAt: null, acknowledgedBy: null,
    }],
    availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' },
  },
}
const LISTINGS_BODY = { pagination: { total: 100 } }
const LISTING_REFRESH_BODY = {
  data: {
    generatedAt: new Date().toISOString(),
    sources: { total: 1, active: 1, needsAttention: 0, totalListings: 42, observedActiveListings: 42, eligibleListings: 42, lastScrapedAt: new Date().toISOString() },
    listings: { active: 42, observedActive: 42, eligible: 42, mapReady: 42, missingLocations: 0 },
    latestScrapeRun: null,
    queues: [],
  },
}

function mockFetch() {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/health')) return jsonResponse(HEALTH_BODY)
    if (url.endsWith('/admin/queues')) return jsonResponse(QUEUES_BODY)
    if (url.endsWith('/admin/sources')) return jsonResponse(SOURCES_BODY)
    if (url.endsWith('/admin/runs')) return jsonResponse(RUNS_BODY)
    if (url.endsWith('/admin/repeatables')) return jsonResponse(SCHEDULES_BODY)
    if (url.endsWith('/admin/listing-refresh/status')) return jsonResponse(LISTING_REFRESH_BODY)
    if (url.endsWith('/internal/ops/problem-aggregate')) return jsonResponse(PROBLEM_AGGREGATE_BODY)
    if (url.includes('/v1/listings')) return jsonResponse(LISTINGS_BODY)
    throw new Error(`Unexpected URL in test: ${url}`)
  })
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

beforeEach(() => {
  clearWarmCache()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DashboardGridClient — renders live data per panel (#912)', () => {
  it('renders each section as a distinct panel with data matching its current /ops equivalent', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<DashboardGridClient apiBaseUrl="" />)

    const healthPanel = await screen.findByRole('region', { name: 'Service health' })
    expect(within(healthPanel).getByText(/Valkey/i)).not.toBeNull()

    const problemsPanel = screen.getByRole('region', { name: 'Active problems' })
    await waitFor(() => expect(within(problemsPanel).getByText(/is down/i)).not.toBeNull())

    const queuesPanel = screen.getByRole('region', { name: 'Queue depth' })
    expect(within(queuesPanel).getByText('source-scrape')).not.toBeNull()
    expect(within(queuesPanel).getByText('3f')).not.toBeNull()
    // The visible "3f" abbreviation is `aria-hidden`; screen readers get the
    // full-word row-level label instead (accessibility fix, #912 review).
    expect(within(queuesPanel).getByLabelText('source-scrape, waiting 2, active 1, delayed 0, failed 3')).not.toBeNull()

    const runsPanel = screen.getByRole('region', { name: 'Recent source runs' })
    expect(within(runsPanel).getByText('BLVD')).not.toBeNull()

    const schedulesPanel = screen.getByRole('region', { name: 'Recurring jobs' })
    expect(within(schedulesPanel).getByText('Nightly scrape')).not.toBeNull()

    const readinessPanel = screen.getByRole('region', { name: 'Site readiness' })
    await waitFor(() => {
      expect(within(readinessPanel).getAllByRole('listitem').length).toBeGreaterThan(0)
    })
  })

  it('renders the site-readiness panel as a dense multi-column checklist, not the one-column /ops/readiness list', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<DashboardGridClient apiBaseUrl="" />)

    const readinessPanel = await screen.findByRole('region', { name: 'Site readiness' })
    const checklist = await waitFor(() => within(readinessPanel).getByRole('list', { name: 'Site readiness checklist' }))

    // Multi-column grid — distinct from the single, undefined-column
    // `.readinessList { display: grid; gap: ... }` on /ops/readiness.
    const gridTemplateColumns = getComputedStyle(checklist).gridTemplateColumns
    expect(gridTemplateColumns).toMatch(/repeat|minmax/)

    const items = within(readinessPanel).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.hasAttribute('data-status')).toBe(true)
    }
  })

  it('closing a panel removes it from the grid and hands focus to the page heading, not <body>', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<DashboardGridClient apiBaseUrl="" />)

    await screen.findByRole('region', { name: 'Recurring jobs' })
    fireEvent.click(screen.getByRole('button', { name: 'Close Recurring jobs' }))

    expect(screen.queryByRole('region', { name: 'Recurring jobs' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Dashboard grid' }))
  })

  it('does not fetch any endpoint beyond the existing Overview/readiness data sources', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<DashboardGridClient apiBaseUrl="" />)

    await screen.findByRole('region', { name: 'Site readiness' })
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => url as string)
      expect(urls.some(u => u.endsWith('/health'))).toBe(true)
      expect(urls.some(u => u.endsWith('/admin/queues'))).toBe(true)
      expect(urls.some(u => u.endsWith('/admin/runs'))).toBe(true)
      expect(urls.some(u => u.endsWith('/admin/repeatables'))).toBe(true)
      expect(urls.some(u => u.includes('/v1/listings'))).toBe(true)
    })
  })
})
