// @vitest-environment jsdom
//
// Component-level rendering test for LogsClient's deep-link params (#761 AC: "/ops/logs
// honors service and time-window query params from inbound links, verified by tests").
// LogsClient.test.ts intentionally keeps to pure-function extraction; this file covers
// the one behavior that only exists in the rendered component: how `initialService`,
// `initialStart`, and `initialEnd` props (populated by page.tsx from `?service=&start=&end=`)
// shape the `/admin/logs` query.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogsClient } from './LogsClient'

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('LogsClient deep-link params', () => {
  it('includes service, start, and end in the /admin/logs query when provided via deep-link props', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entries: [], services: ['scraper'] }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <LogsClient
        apiBaseUrl="http://api.test"
        initialService="scraper"
        initialStart="2026-07-20T10:00:00.000Z"
        initialEnd="2026-07-20T10:05:00.000Z"
      />,
    )

    await screen.findByText(/no log entries found/i)

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    const url = new URL(calledUrl)
    expect(url.searchParams.get('service')).toBe('scraper')
    expect(url.searchParams.get('start')).toBe('2026-07-20T10:00:00.000Z')
    expect(url.searchParams.get('end')).toBe('2026-07-20T10:05:00.000Z')
  })

  it('pre-selects the deep-linked service in the filter dropdown before /admin/logs returns its services list', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ entries: [], services: [] })))

    render(<LogsClient apiBaseUrl="http://api.test" initialService="scraper" />)

    const select = screen.getByLabelText('Filter by service') as HTMLSelectElement
    expect(select.value).toBe('scraper')
    expect(screen.getByRole('option', { name: 'scraper' })).toBeDefined()
  })

  it('omits service/start/end from the query when no deep-link props are given (default "all services", last hour)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entries: [], services: [] }))
    vi.stubGlobal('fetch', fetchMock)

    render(<LogsClient apiBaseUrl="http://api.test" />)

    await screen.findByText(/no log entries found/i)

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    const url = new URL(calledUrl)
    expect(url.searchParams.has('service')).toBe(false)
    expect(url.searchParams.has('start')).toBe(false)
    expect(url.searchParams.has('end')).toBe(false)
  })
})
