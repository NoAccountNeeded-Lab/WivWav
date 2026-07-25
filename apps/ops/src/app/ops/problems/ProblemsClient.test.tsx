// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProblemsClient } from './ProblemsClient'
import { clearWarmCache } from '@/lib/warm-data-cache'

const HEALTH_BODY = { data: { status: 'ok', timestamp: new Date().toISOString(), services: {} } }
const EMPTY_LIST = { data: [] }
const LISTING_REFRESH_BODY = {
  data: {
    generatedAt: new Date().toISOString(),
    sources: { total: 0, active: 0, needsAttention: 0, totalListings: 0, observedActiveListings: 0, eligibleListings: 0, lastScrapedAt: null },
    listings: { active: 0, observedActive: 0, eligible: 0, mapReady: 0, missingLocations: 0 },
    latestScrapeRun: null,
    queues: [],
  },
}

const ACTIVE_PROBLEM = {
  fingerprint: 'domain:queue_failed_jobs:queue:*',
  source: 'domain',
  severity: 'critical',
  detail: '3 failed jobs are present across queues.',
  evidenceId: 'queue:*',
  href: null,
  firstSeen: new Date(Date.now() - 60 * 60_000).toISOString(),
  lastSeen: new Date(Date.now() - 5 * 60_000).toISOString(),
  occurrenceCount: 3,
  acknowledgedAt: null,
  acknowledgedBy: null,
}

const ACKNOWLEDGED_PROBLEM = {
  fingerprint: 'domain:queue_paused:queue:*',
  source: 'domain',
  severity: 'warning',
  detail: 'geocode',
  evidenceId: 'queue:*',
  href: null,
  firstSeen: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  lastSeen: new Date(Date.now() - 30 * 60_000).toISOString(),
  occurrenceCount: 1,
  acknowledgedAt: new Date().toISOString(),
  acknowledgedBy: 'ops@example.com',
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function mockFetch(problemAggregateBody: unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/health')) return jsonResponse(HEALTH_BODY)
    if (url.endsWith('/admin/queues')) return jsonResponse(EMPTY_LIST)
    if (url.endsWith('/admin/sources')) return jsonResponse(EMPTY_LIST)
    if (url.endsWith('/admin/runs')) return jsonResponse(EMPTY_LIST)
    if (url.endsWith('/admin/repeatables')) return jsonResponse(EMPTY_LIST)
    if (url.endsWith('/admin/listing-refresh/status')) return jsonResponse(LISTING_REFRESH_BODY)
    if (url.endsWith('/internal/ops/problem-aggregate')) return jsonResponse(problemAggregateBody)
    if (url.endsWith('/internal/ops/problem-ack')) {
      const body = JSON.parse(String(init?.body)) as { fingerprint: string; acknowledged: boolean }
      return jsonResponse({
        data: {
          acknowledgedAt: body.acknowledged ? new Date().toISOString() : null,
          acknowledgedBy: body.acknowledged ? null : null,
        },
      })
    }
    throw new Error(`Unexpected URL in test: ${url}`)
  })
}

beforeEach(() => {
  clearWarmCache()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProblemsClient (issue #892)', () => {
  it('shows active problems by default and hides acknowledged ones', async () => {
    vi.stubGlobal('fetch', mockFetch({
      data: {
        problems: [ACTIVE_PROBLEM, ACKNOWLEDGED_PROBLEM],
        availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' },
      },
    }))

    render(<ProblemsClient apiBaseUrl="" />)

    expect(await screen.findByText('Failed jobs need review')).not.toBeNull()
    expect(screen.queryByText('Queues are paused')).toBeNull()
  })

  it('reveals acknowledged problems (without losing them) via the "All, incl. acknowledged" filter', async () => {
    vi.stubGlobal('fetch', mockFetch({
      data: {
        problems: [ACTIVE_PROBLEM, ACKNOWLEDGED_PROBLEM],
        availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' },
      },
    }))

    render(<ProblemsClient apiBaseUrl="" />)
    await screen.findByText('Failed jobs need review')

    fireEvent.click(screen.getByRole('button', { name: /all, incl\. acknowledged/i }))

    expect(await screen.findByText('Queues are paused')).not.toBeNull()
  })

  it('acknowledging a problem removes it from the default (active) view immediately', async () => {
    vi.stubGlobal('fetch', mockFetch({
      data: {
        problems: [ACTIVE_PROBLEM],
        availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' },
      },
    }))

    render(<ProblemsClient apiBaseUrl="" />)
    await screen.findByText('Failed jobs need review')

    const ackButton = screen.getByRole('button', { name: /^Acknowledge Failed jobs need review$/i })
    await act(async () => {
      fireEvent.click(ackButton)
    })

    await waitFor(() => {
      expect(screen.queryByText('Failed jobs need review')).toBeNull()
    })

    // Still visible (with history intact) under the "All" filter.
    fireEvent.click(screen.getByRole('button', { name: /all, incl\. acknowledged/i }))
    expect(await screen.findByText('Failed jobs need review')).not.toBeNull()
  })

  it('shows a quiet empty state when there are no active problems', async () => {
    vi.stubGlobal('fetch', mockFetch({
      data: { problems: [], availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' } },
    }))

    render(<ProblemsClient apiBaseUrl="" />)

    expect(await screen.findByText(/no active problems/i)).not.toBeNull()
  })
})
