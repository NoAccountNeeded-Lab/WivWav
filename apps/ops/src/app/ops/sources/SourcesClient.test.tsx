// @vitest-environment jsdom
//
// #761 AC: "From a source's last-error, the operator reaches the corresponding run and
// its filtered logs in ≤ 2 clicks" and "no dead links when optional fields are absent —
// hidden, not broken". Covers the "View run" / "View logs" links SourcesClient renders
// next to a source's last error.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcesClient } from './SourcesClient'

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const ERRORED_SOURCE = {
  id: 'source-1',
  name: 'Acme Motors',
  baseUrl: 'https://acme.example.com',
  status: 'error',
  cronExpression: '0 * * * *',
  lastScrapedAt: '2026-07-20T10:05:00.000Z',
  listingCount: 12,
  observedActiveCount: 10,
  eligibleActiveCount: 9,
  errorMessage: 'Timeout fetching listing index',
}

const HEALTHY_SOURCE = {
  ...ERRORED_SOURCE,
  id: 'source-2',
  name: 'Beta Vans',
  status: 'active',
  errorMessage: null,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('SourcesClient last-error deep links', () => {
  it('links a source\'s last error to its filtered run list and to logs scoped by service + sourceId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([ERRORED_SOURCE])))

    render(<SourcesClient apiBaseUrl="http://api.test" />)

    await screen.findByText('Timeout fetching listing index')

    const runLink = screen.getByRole('link', { name: 'View run' })
    expect(runLink.getAttribute('href')).toBe('/ops/runs?sourceId=source-1&filter=failed')

    const logsLink = screen.getByRole('link', { name: 'View logs' })
    expect(logsLink.getAttribute('href')).toBe('/ops/logs?service=scraper&search=source-1')
  })

  it('renders no "View run"/"View logs" links for a healthy source with no errorMessage (hidden, not broken)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([HEALTHY_SOURCE])))

    render(<SourcesClient apiBaseUrl="http://api.test" />)

    await screen.findByText('Beta Vans')

    expect(screen.queryByRole('link', { name: 'View run' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'View logs' })).toBeNull()
  })
})
