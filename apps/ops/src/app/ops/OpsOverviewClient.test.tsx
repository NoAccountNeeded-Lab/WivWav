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
// The Attention panel's Problems preview now renders from the shared
// problem-aggregate computation (issue #892) rather than recomputing
// conditions client-side, so every fetch mock below must also answer this
// endpoint.
const PROBLEM_AGGREGATE_BODY = {
  data: {
    problems: [],
    availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' },
  },
}

function mockFetchWithFailingRuns() {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/health')) return jsonResponse(HEALTH_BODY)
    if (url.endsWith('/admin/queues')) return jsonResponse(QUEUES_BODY)
    if (url.endsWith('/admin/sources')) return jsonResponse(SOURCES_BODY)
    if (url.endsWith('/admin/runs')) return { ok: false, status: 503, json: async () => ({}) } as Response
    if (url.endsWith('/admin/repeatables')) return jsonResponse(SCHEDULES_BODY)
    if (url.endsWith('/internal/ops/problem-aggregate')) return jsonResponse(PROBLEM_AGGREGATE_BODY)
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
    // All services are healthy here, so the health grid collapses into the
    // quiet summary row (#760) instead of an individual "API" card.
    await waitFor(() => {
      expect(screen.getByText('All services healthy')).not.toBeNull()
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
      if (url.endsWith('/internal/ops/problem-aggregate')) return jsonResponse(PROBLEM_AGGREGATE_BODY)
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

function mockFetchWith(overrides: { health?: unknown; queues?: unknown; problemAggregate?: unknown } = {}) {
  const health = overrides.health ?? HEALTH_BODY
  const queues = overrides.queues ?? QUEUES_BODY
  const problemAggregate = overrides.problemAggregate ?? PROBLEM_AGGREGATE_BODY
  return vi.fn(async (url: string) => {
    if (url.endsWith('/health')) return jsonResponse(health)
    if (url.endsWith('/admin/queues')) return jsonResponse(queues)
    if (url.endsWith('/admin/sources')) return jsonResponse(SOURCES_BODY)
    if (url.endsWith('/admin/runs')) return jsonResponse({ data: [] })
    if (url.endsWith('/admin/repeatables')) return jsonResponse(SCHEDULES_BODY)
    if (url.endsWith('/internal/ops/problem-aggregate')) return jsonResponse(problemAggregate)
    throw new Error(`Unexpected URL in test: ${url}`)
  })
}

describe('OpsOverviewClient — calm overview (#760)', () => {
  it('renders zero warning/critical-colored elements and a compact healthy-summary row when everything is healthy', async () => {
    vi.stubGlobal('fetch', mockFetchWith())

    const { container } = render(<OpsOverviewClient apiBaseUrl="" />)

    await screen.findByText('All services healthy')

    // No individual service cards render — the grid collapsed into the
    // single summary row.
    expect(screen.queryByText('API')).toBeNull()
    expect(screen.queryByText('Database')).toBeNull()

    // Nothing on the page carries a warning/critical severity signal.
    expect(container.querySelectorAll('[data-severity="warning"]').length).toBe(0)
    expect(container.querySelectorAll('[data-severity="critical"]').length).toBe(0)
  })

  it('shows a degraded resource card with severity styling while unaffected resources stay in the quiet summary', async () => {
    const degradedHealth = {
      data: {
        ...HEALTH_BODY.data,
        services: { ...HEALTH_BODY.data.services, postgres: { status: 'down' } },
      },
    }
    vi.stubGlobal('fetch', mockFetchWith({ health: degradedHealth }))

    const { container } = render(<OpsOverviewClient apiBaseUrl="" />)

    // The degraded service gets its own card with critical styling...
    const dbLabel = await screen.findByText('Database')
    const dbCard = dbLabel.closest('a, article') as HTMLElement
    expect(within(dbCard).getAllByText(/^Down$/).length).toBeGreaterThan(0)
    expect(dbCard.querySelectorAll('[data-severity="critical"]').length).toBe(1)

    // ...while the remaining healthy services collapse into the quiet
    // summary row rather than each rendering their own card.
    expect(await screen.findByText(/other services? healthy/i)).not.toBeNull()
    expect(screen.queryByText('API')).toBeNull()

    // Only the one degraded service contributes a critical signal anywhere
    // on the page.
    expect(container.querySelectorAll('[data-severity="critical"]').length).toBe(1)
  })

  it('renders a quiet empty state in the Attention panel when nothing needs attention', async () => {
    vi.stubGlobal('fetch', mockFetchWith())

    render(<OpsOverviewClient apiBaseUrl="" />)

    const empty = await screen.findByText('Nothing needs attention')
    expect(empty).not.toBeNull()
    // The empty state renders inside the Attention panel, not as an
    // alarm-styled attention-item link.
    const attentionList = empty.closest('[class*="attentionList"]') as HTMLElement
    expect(within(attentionList).queryByRole('link')).toBeNull()
  })

  it('gives each metric card at most one severity-colored element in the DOM', async () => {
    const degradedHealth = {
      data: {
        ...HEALTH_BODY.data,
        services: { ...HEALTH_BODY.data.services, postgres: { status: 'down' } },
      },
    }
    vi.stubGlobal('fetch', mockFetchWith({ health: degradedHealth }))

    render(<OpsOverviewClient apiBaseUrl="" />)

    const dbLabel = await screen.findByText('Database')
    const dbCard = dbLabel.closest('a, article') as HTMLElement

    // Exactly one severity-colored signal (the status dot) — the icon
    // carries no severity attribute at all.
    expect(dbCard.querySelectorAll('[data-severity]').length).toBe(1)
  })
})

describe('OpsOverviewClient — Problems preview (issue #892)', () => {
  it('renders a top-N preview of unacknowledged problems from the shared problem-aggregate call and links to /ops/problems', async () => {
    const problemAggregate = {
      data: {
        problems: [
          {
            fingerprint: 'domain:queue_failed_jobs:queue:*',
            source: 'domain',
            severity: 'critical',
            detail: '3 failed jobs are present across queues.',
            evidenceId: 'queue:*',
            href: null,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            occurrenceCount: 1,
            acknowledgedAt: null,
            acknowledgedBy: null,
          },
          {
            fingerprint: 'sentry:sentry-1',
            source: 'sentry',
            severity: 'critical',
            detail: 'TypeError: x is not a function',
            evidenceId: 'sentry:sentry-1',
            href: 'https://sentry.io/issues/sentry-1',
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            occurrenceCount: 4,
            acknowledgedAt: new Date().toISOString(),
            acknowledgedBy: 'ops@example.com',
          },
        ],
        availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' },
      },
    }
    vi.stubGlobal('fetch', mockFetchWith({ problemAggregate }))

    render(<OpsOverviewClient apiBaseUrl="" />)

    // Only the unacknowledged problem renders in the preview.
    expect(await screen.findByText('Failed jobs need review')).not.toBeNull()
    expect(screen.queryByText('TypeError: x is not a function')).toBeNull()

    const viewAll = screen.getByRole('link', { name: /view all problems/i })
    expect(viewAll.getAttribute('href')).toBe('/ops/problems')

    // Nothing needs attention no longer shows since a real problem is present.
    expect(screen.queryByText('Nothing needs attention')).toBeNull()
  })
})
