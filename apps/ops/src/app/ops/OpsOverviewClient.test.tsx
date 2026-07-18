// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpsOverviewClient } from './OpsOverviewClient'
import { clearWarmCache } from '@/lib/warm-data-cache'

const HEALTH_BODY = {
  data: {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      postgres: { status: 'up' },
      meilisearch: { status: 'up' },
      valkey: { status: 'up' },
      ollama: { status: 'up' },
      scraper: { status: 'up' },
    },
  },
}

const QUEUES_BODY = { data: [{ name: 'source-scrape', paused: false, stats: { waiting: 0, active: 1, completed: 10, failed: 0, delayed: 0 } }] }
const SOURCES_BODY = {
  data: [{
    id: 'src-1', name: 'BLVD', status: 'ok', lastScrapedAt: new Date().toISOString(),
    lastFullCrawlAt: new Date().toISOString(), lastObservedAt: new Date().toISOString(),
    listingCount: 42, errorMessage: null, possiblyGoneCount: 0,
  }],
}
const SCHEDULES_BODY = {
  data: [{
    id: 'sched-1', queue: 'source-scrape', label: 'Nightly scrape', enabled: true,
    lastRunAt: new Date().toISOString(), lastStatus: 'completed', recentFailureCount: 0, recentFailureReason: null,
  }],
}
// The Attention panel now renders from the shared attention-snapshot
// computation (issue #774) rather than recomputing conditions client-side,
// so every fetch mock below must also answer this endpoint.
const ATTENTION_BODY = {
  data: {
    conditions: [],
    signalAvailability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available' },
  },
}

function mockFetchWithFailingRuns() {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/health')) return jsonResponse(HEALTH_BODY)
    if (url.endsWith('/admin/queues')) return jsonResponse(QUEUES_BODY)
    if (url.endsWith('/admin/sources')) return jsonResponse(SOURCES_BODY)
    if (url.endsWith('/admin/runs')) return { ok: false, status: 503, json: async () => ({}) } as Response
    if (url.endsWith('/admin/repeatables')) return jsonResponse(SCHEDULES_BODY)
    if (url.endsWith('/admin/attention-snapshot')) return jsonResponse(ATTENTION_BODY)
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OpsOverviewClient — streaming sections and per-section retry (E5, #732)', () => {
  it('shows an inline error with retry for the failed endpoint while other sections render normally', async () => {
    const fetchMock = mockFetchWithFailingRuns()
    vi.stubGlobal('fetch', fetchMock)

    render(<OpsOverviewClient apiBaseUrl="" />)

    // The failing "runs" endpoint surfaces as an inline attention item...
    const failedItem = await screen.findByText(/scraper run telemetry unavailable/i)
    expect(failedItem).not.toBeNull()

    // ...with its own Retry action.
    const attentionList = failedItem.closest('[class*="attentionList"]') as HTMLElement
    const retryButton = within(attentionList).getByRole('button', { name: /retry/i })
    expect(retryButton).not.toBeNull()

    // Sibling sections built from the endpoints that succeeded still render
    // their real data — the one failure does not blank the rest of the page.
    await waitFor(() => {
      expect(screen.getByText('API')).not.toBeNull()
      // Active-listings card, built from the successful "sources" endpoint.
      expect(screen.getByText('42')).not.toBeNull()
    })

    const callsBeforeRetry = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/admin/runs')).length
    expect(callsBeforeRetry).toBeGreaterThanOrEqual(1)

    // Clicking retry re-fetches only that resource.
    await act(async () => {
      fireEvent.click(retryButton)
    })

    await waitFor(() => {
      const callsAfterRetry = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/admin/runs')).length
      expect(callsAfterRetry).toBeGreaterThan(callsBeforeRetry)
    })
  })

  it('renders the bento grid immediately on mount instead of a full-page loading gate', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => { /* never resolves — first paint only */ })))

    render(<OpsOverviewClient apiBaseUrl="" />)

    // The section labels and attention panel are present from first paint,
    // before any endpoint has resolved — this is what keeps CLS ≈ 0 on
    // route entry (no swap from a "Loading…" panel to the real grid).
    expect(screen.getByText('Service & Queue Health')).not.toBeNull()
    expect(screen.getByText('Listing Freshness')).not.toBeNull()
    expect(screen.getByLabelText('Attention needed')).not.toBeNull()
  })

  it('shows relative freshness text with an absolute tooltip on the overview card', async () => {
    const finishedAt = new Date(Date.now() - 10 * 60_000).toISOString()
    const runsBody = {
      data: [{
        id: 'run-1',
        sourceId: 'src-1',
        sourceName: 'BLVD',
        startedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
        finishedAt,
        success: true,
        listingsFound: 42,
        listingsNew: 1,
        listingsUpdated: 2,
        errorMessage: null,
      }],
    }

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH_BODY)
      if (url.endsWith('/admin/queues')) return jsonResponse(QUEUES_BODY)
      if (url.endsWith('/admin/sources')) return jsonResponse(SOURCES_BODY)
      if (url.endsWith('/admin/runs')) return jsonResponse(runsBody)
      if (url.endsWith('/admin/repeatables')) return jsonResponse(SCHEDULES_BODY)
      if (url.endsWith('/admin/attention-snapshot')) return jsonResponse(ATTENTION_BODY)
      throw new Error(`Unexpected URL in test: ${url}`)
    }))

    render(<OpsOverviewClient apiBaseUrl="" />)

    const freshnessLabel = await screen.findByText('Last successful scrape')
    const card = freshnessLabel.closest('a, article')
    const relativeValue = card?.querySelector('strong')

    expect(relativeValue?.textContent).toMatch(/ago$/)
    expect(relativeValue?.getAttribute('title')).toBeTruthy()
  })
})
