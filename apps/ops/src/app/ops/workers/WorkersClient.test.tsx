// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkersClient } from './WorkersClient'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

const WORKER = {
  workerId: 'worker-1',
  workerName: 'Desk laptop',
  capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 3 },
  inFlightCount: 1,
  inFlightJobs: [
    {
      queueName: 'detail-crawl',
      correlationId: 'detail-crawl:7',
      dispatchedAt: new Date(Date.now() - 60_000).toISOString(),
    },
  ],
  recentJobs: [
    {
      queueName: 'source-scrape',
      correlationId: 'source-scrape:3',
      success: false,
      errorMessage: 'worker reported failure',
      finishedAt: new Date().toISOString(),
    },
  ],
  lastHeartbeatAt: new Date().toISOString(),
}

const ESCALATED_WORKER = {
  workerId: 'worker-3',
  workerName: 'Old laptop',
  capabilities: { chromium: false, httpEnrich: false, maxConcurrentJobs: 1 },
  inFlightCount: 0,
  inFlightJobs: [],
  recentJobs: [
    {
      queueName: 'source-scrape',
      correlationId: 'source-scrape:9',
      success: false,
      escalated: true,
      errorMessage: "worker requested capability 'chromium': blocked over http",
      finishedAt: new Date().toISOString(),
    },
  ],
  lastHeartbeatAt: new Date().toISOString(),
}

const IDLE_WORKER = {
  workerId: 'worker-2',
  workerName: 'Spare laptop',
  capabilities: { chromium: false, httpEnrich: true, maxConcurrentJobs: 2 },
  inFlightCount: 0,
  inFlightJobs: [],
  recentJobs: [],
  lastHeartbeatAt: new Date().toISOString(),
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('WorkersClient', () => {
  it('renders one row per worker with capabilities and in-flight/max count', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/admin/workers')) return jsonResponse({ data: [WORKER] })
      throw new Error(`Unexpected URL in test: ${url}`)
    }))

    render(<WorkersClient apiBaseUrl="" />)

    expect(await screen.findByText('Desk laptop')).toBeDefined()
    expect(screen.getByText('worker-1')).toBeDefined()
    expect(screen.getByText('chromium: yes')).toBeDefined()
    expect(screen.getByText('httpEnrich: no')).toBeDefined()
    expect(screen.getByText('1 / 3')).toBeDefined()
    expect(screen.getByRole('columnheader', { name: 'Current job' })).toBeDefined()
    const rows = screen.getAllByRole('row')
    expect(within(rows[1] as HTMLElement).getByText('detail-crawl')).toBeDefined()
    expect(screen.getAllByRole('row')).toHaveLength(2) // header + one worker (detail row hidden)
  })

  it('shows the current job and expands to correlation id plus recent errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [WORKER] })))

    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Desk laptop')

    const rowId = 'worker-details-worker-1-0'
    const detailRow = () => document.getElementById(rowId) as HTMLTableRowElement
    const expand = screen.getByRole('button', { name: 'Expand job details for Desk laptop' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(detailRow().hidden).toBe(true)

    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Collapse job details for Desk laptop' }).getAttribute('aria-expanded')).toBe('true')
    expect(detailRow().hidden).toBe(false)
    expect(within(detailRow()).getByText('detail-crawl:7')).toBeDefined()
    expect(within(detailRow()).getByText('failed')).toBeDefined()
    expect(within(detailRow()).getByText('worker reported failure')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse job details for Desk laptop' }))
    expect(detailRow().hidden).toBe(true)
  })

  it('shows an escalation as escalated, never failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [ESCALATED_WORKER] })))

    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Old laptop')

    fireEvent.click(screen.getByRole('button', { name: 'Expand job details for Old laptop' }))
    const detail = document.getElementById('worker-details-worker-3-0') as HTMLElement
    expect(within(detail).getByText('escalated')).toBeDefined()
    expect(within(detail).queryByText('failed')).toBeNull()
  })

  it('shows an idle worker with no expand control', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [IDLE_WORKER] })))

    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Spare laptop')

    expect(screen.getByText('—')).toBeDefined()
    expect(screen.queryByRole('button', { name: /job details for/ })).toBeNull()
  })

  it('labels the heartbeat as received, never online, and explains ping/pong liveness', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [WORKER] })))

    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Desk laptop')

    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Last heartbeat received' })).toBeDefined()
    expect(screen.queryByText(/online/i)).toBeNull()
    expect(screen.getByText(/ping\/pong/)).toBeDefined()
  })

  it('shows an empty state when no worker is connected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })))

    render(<WorkersClient apiBaseUrl="" />)

    expect(await screen.findByText(/No workers are connected/)).toBeDefined()
  })

  it('shows an error when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 }) as Response))

    render(<WorkersClient apiBaseUrl="" />)

    expect(await screen.findByText(/could not load: API returned 401/)).toBeDefined()
  })

  it('keeps the last good rows visible when a refetch fails', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [WORKER] }))
      .mockResolvedValue({ ok: false, status: 503 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkersClient apiBaseUrl="" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

    expect(screen.getByText(/API returned 503/)).toBeDefined()
    expect(screen.getByText('Desk laptop')).toBeDefined()
  })

  it('does not announce the periodic "Updated" timestamp as a live region', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [WORKER] })))

    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Desk laptop')

    expect(screen.getByText(/^Updated /)).toBeDefined()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('announces a load failure through an alert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response))

    render(<WorkersClient apiBaseUrl="" />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/API returned 500/)
  })

  it('treats a malformed 200 body as an error and keeps the last good rows', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [WORKER] }))
      .mockResolvedValue(jsonResponse({ data: [{ workerId: 'worker-2' }] }))
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkersClient apiBaseUrl="" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

    expect(screen.getByRole('alert').textContent).toMatch(/unexpected response/)
    expect(screen.getByText('Desk laptop')).toBeDefined()
    expect(screen.queryByText('worker-2')).toBeNull()
  })

  it('rejects a body whose data is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: null })))

    render(<WorkersClient apiBaseUrl="" />)

    expect(await screen.findByText(/unexpected response/)).toBeDefined()
  })

  it('polls and drops a worker that disconnects between refreshes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [WORKER] }))
      .mockResolvedValue(jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkersClient apiBaseUrl="" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('Desk laptop')).toBeDefined()

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(screen.queryByText('Desk laptop')).toBeNull()
    expect(screen.getByText(/No workers are connected/)).toBeDefined()
  })
})
