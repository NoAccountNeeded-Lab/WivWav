// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkersClient } from './WorkersClient'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

const WORKER = {
  workerId: 'worker-1',
  workerName: 'Desk laptop',
  capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 3 },
  inFlightCount: 2,
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
    expect(screen.getByText('2 / 3')).toBeDefined()
    expect(screen.getAllByRole('row')).toHaveLength(2) // header + one worker
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
