// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkersClient } from './WorkersClient'

const SUMMARY = {
  workers: 1, busyWorkers: 1, inFlight: 1, capacity: 3, completed: 4, failed: 1, escalated: 0,
  successRate: 0.8, avgDurationMs: 2000, jobsPerMinute: 2.5, statsSince: new Date().toISOString(),
  queues: [{ queueName: 'source-scrape', running: 0, completed: 4, failed: 1, avgDurationMs: 2000 }],
}
const MACHINE = {
  hostname: 'crawler-laptop',
  platform: 'linux',
  osRelease: '6.8.0-test',
  arch: 'x64',
  cpuModel: 'Test CPU',
  cpuCount: 6,
  totalMemBytes: 16_000_000_000,
  nodeVersion: 'v26.5.0',
  appVersion: '0.0.1',
}
const EMPTY_SUMMARY = {
  ...SUMMARY, workers: 0, busyWorkers: 0, inFlight: 0, capacity: 0, completed: 0, failed: 0,
  successRate: null, avgDurationMs: null, jobsPerMinute: null, statsSince: null, queues: [],
}

function jsonResponse(body: { data: unknown[]; summary?: unknown }): Response {
  return { ok: true, status: 200, json: async () => ({ summary: body.data.length ? SUMMARY : EMPTY_SUMMARY, ...body }) } as Response
}

const WORKER = {
  connectionId: 'conn-1',
  accepting: true,
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
      durationMs: 1500,
      finishedAt: new Date().toISOString(),
    },
  ],
  lastHeartbeatAt: new Date().toISOString(),
  connectedAt: new Date().toISOString(),
  completed: 4,
  failed: 1,
  escalated: 0,
  totalDurationMs: 10_000,
  timed: 4,
}

const ESCALATED_WORKER = {
  connectionId: 'conn-3',
  accepting: true,
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
  connectedAt: new Date().toISOString(),
  completed: 4,
  failed: 1,
  escalated: 0,
  totalDurationMs: 10_000,
  timed: 4,
}

const IDLE_WORKER = {
  connectionId: 'conn-2',
  accepting: true,
  workerId: 'worker-2',
  workerName: 'Spare laptop',
  capabilities: { chromium: false, httpEnrich: true, maxConcurrentJobs: 2 },
  inFlightCount: 0,
  inFlightJobs: [],
  recentJobs: [],
  lastHeartbeatAt: new Date().toISOString(),
  connectedAt: new Date().toISOString(),
  completed: 4,
  failed: 1,
  escalated: 0,
  totalDurationMs: 10_000,
  timed: 4,
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('WorkersClient', () => {
  it('renders the summary strip, per-queue table and one card per worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [WORKER, IDLE_WORKER] })))
    render(<WorkersClient apiBaseUrl="" />)

    expect(await screen.findByText('Desk laptop')).toBeDefined()
    expect(screen.getByText('Spare laptop')).toBeDefined()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    const strip = screen.getByRole('region', { name: 'Fleet summary' })
    expect(within(strip).getByText('80.0%')).toBeDefined()
    expect(within(strip).getByText('2.5')).toBeDefined()
    expect(screen.getByRole('img', { name: '33% of job slots in use' })).toBeDefined()
    const queueLink = screen.getByRole('link', { name: 'source-scrape' })
    expect(queueLink.getAttribute('href')).toBe('/ops/queues')
    expect(screen.getByText(/reset when the API restarts/)).toBeDefined()
  })

  it('shows machine details, capabilities, and concurrency when worker details open', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [{ ...WORKER, machine: MACHINE }] })))
    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Desk laptop')

    const details = screen.getByText('Worker details')
    expect(details.tagName).toBe('SUMMARY')
    expect(details.tabIndex).toBe(0)
    await act(async () => { details.click() })

    expect(screen.getByText('crawler-laptop')).toBeDefined()
    expect(screen.getByText('Test CPU')).toBeDefined()
    expect(screen.getByText('16,000,000,000 bytes')).toBeDefined()
    expect(screen.getByText('v26.5.0')).toBeDefined()
    expect(screen.getByText('0.0.1')).toBeDefined()
    expect(screen.getByText('Maximum concurrent jobs')).toBeDefined()
    expect(screen.getByText('3')).toBeDefined()
  })

  it('shows a not-reported state for a legacy worker without machine metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [WORKER] })))
    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Desk laptop')
    await act(async () => { screen.getByText('Worker details').click() })

    expect(screen.getByText('Machine details not reported by this worker.')).toBeDefined()
    expect(screen.getByText('Maximum concurrent jobs')).toBeDefined()
  })

  it('links the worker, current job and recent pips to the logs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [WORKER] })))
    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Desk laptop')

    expect(screen.getByRole('link', { name: 'Desk laptop' }).getAttribute('href')).toBe('/ops/logs?search=Desk+laptop')
    const job = screen.getByRole('link', { name: /detail-crawl:7/ })
    const url = new URL(job.getAttribute('href') as string, 'http://x')
    expect(url.pathname).toBe('/ops/logs')
    expect(url.searchParams.get('search')).toBe('detail-crawl:7')
    expect(Date.parse(url.searchParams.get('start') as string)).toBeLessThan(Date.now() - 119_000)
    // elapsed time and queue name render on the job row
    expect(within(job).getByText('detail-crawl')).toBeDefined()
    expect(within(job).getByText(/^\d+:\d\d$/)).toBeDefined()

    const pip = screen.getByRole('link', { name: /Failed: worker reported failure/ })
    expect(pip.getAttribute('title')).toMatch(/worker reported failure/)
    expect(new URL(pip.getAttribute('href') as string, 'http://x').searchParams.get('search')).toBe('source-scrape:3')
  })

  it('ticks the elapsed timer every second', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [WORKER] })))
    render(<WorkersClient apiBaseUrl="" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const before = screen.getByText(/^\d+:\d\d$/).textContent
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.getByText(/^\d+:\d\d$/).textContent).not.toBe(before)
  })

  it('shows an escalation as escalated, never failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [ESCALATED_WORKER] })))
    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Old laptop')

    const pip = screen.getByRole('link', { name: /^Escalated \(requeued\): worker requested capability/ })
    expect(pip.getAttribute('data-kind')).toBe('esc')
    expect(screen.queryByRole('link', { name: /^Failed/ })).toBeNull()
    expect(pip.textContent).toBe('↻')
  })

  it('makes each worker a heading and names the queue table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [WORKER, IDLE_WORKER] })))
    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Desk laptop')

    const h3s = screen.getAllByRole('heading', { level: 3 })
    expect(h3s.map((h) => h.textContent)).toEqual(['Desk laptop', 'Spare laptop'])
    expect(within(h3s[0] as HTMLElement).getByRole('link')).toBeDefined()
    expect(screen.getByRole('table', { name: 'By queue' })).toBeDefined()
    expect(screen.getByText('1 busy · 1 idle · 0 stale · 0 paused')).toBeDefined()
  })

  it('averages over timed jobs only and tolerates a bogus max concurrency', async () => {
    const w = { ...WORKER, completed: 3, failed: 0, totalDurationMs: 6000, timed: 2, capabilities: { ...WORKER.capabilities, maxConcurrentJobs: -1 } }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [w] })))
    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Desk laptop')

    expect(screen.getByText('3.0 s')).toBeDefined()
  })

  it('shows an idle worker without a current job', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [IDLE_WORKER] })))
    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Spare laptop')

    expect(screen.getByText(/Idle — waiting for work/)).toBeDefined()
  })

  it('explains that heartbeat is not proof of liveness', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [WORKER] })))
    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Desk laptop')

    expect(screen.queryByText(/online/i)).toBeNull()
    expect(screen.getByText(/ping\/pong/)).toBeDefined()
  })

  it('shows an empty state, not NaN, when no worker is connected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })))
    render(<WorkersClient apiBaseUrl="" />)

    expect(await screen.findByText(/No workers are connected/)).toBeDefined()
    expect(document.body.textContent).not.toMatch(/NaN|0\/0/)
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
      .mockResolvedValue(jsonResponse({ data: [{ workerId: 'worker-2' }], summary: SUMMARY }))
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkersClient apiBaseUrl="" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

    expect(screen.getByRole('alert').textContent).toMatch(/unexpected response/)
    expect(screen.getByText('Desk laptop')).toBeDefined()
    expect(screen.queryByText('worker-2')).toBeNull()
  })

  it('rejects a body whose data is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: null }) }) as Response))

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

  it('pauses a worker via the API and shows the paused state', async () => {
    let paused = false
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        paused = String(url).endsWith('/pause')
        return { ok: true, status: 200, json: async () => ({}) } as Response
      }
      return jsonResponse({ data: [{ ...IDLE_WORKER, accepting: !paused }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<WorkersClient apiBaseUrl="/api/bff" />)
    const pause = await screen.findByRole('button', { name: 'Pause Spare laptop' })
    await act(async () => { pause.click() })

    expect(fetchMock).toHaveBeenCalledWith('/api/bff/internal/ops/workers/conn-2/pause', { method: 'POST' })
    expect(await screen.findByRole('button', { name: 'Resume Spare laptop' })).toBeDefined()
    expect(screen.getByText(/· Paused/)).toBeDefined()
    expect(screen.getByText(/Paused — not taking new work/)).toBeDefined()
  })

  it('reports a stale connection when resume returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? ({ ok: false, status: 404, json: async () => ({}) } as Response)
        : jsonResponse({ data: [{ ...IDLE_WORKER, accepting: false }] })))
    render(<WorkersClient apiBaseUrl="" />)
    const resume = await screen.findByRole('button', { name: 'Resume Spare laptop' })
    await act(async () => { resume.click() })

    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not resume Spare laptop: that worker has disconnected/)
  })

  it('keeps each card disabled until the refreshed list arrives, independently across cards', async () => {
    const state = { 'conn-1': true, 'conn-2': true }
    const gates: Array<() => void> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const id = String(url).includes('conn-1') ? 'conn-1' : 'conn-2'
        await new Promise<void>((r) => gates.push(r))
        state[id] = false
        return { ok: true, status: 200, json: async () => ({}) } as Response
      }
      return jsonResponse({ data: [{ ...WORKER, accepting: state['conn-1'] }, { ...IDLE_WORKER, accepting: state['conn-2'] }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<WorkersClient apiBaseUrl="" />)
    const a = await screen.findByRole('button', { name: 'Pause Desk laptop' })
    const b = screen.getByRole('button', { name: 'Pause Spare laptop' })
    await act(async () => { a.click(); b.click() })
    expect((a as HTMLButtonElement).disabled).toBe(true)
    expect((b as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { gates[0]?.() })
    expect(await screen.findByRole('button', { name: 'Resume Desk laptop' })).toBeDefined()
    expect((screen.getByRole('button', { name: 'Pause Spare laptop' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { gates[1]?.() })
    expect((await screen.findByRole('button', { name: 'Resume Spare laptop' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows an overdue heartbeat on a paused worker and counts it in the summary', async () => {
    const w = { ...IDLE_WORKER, accepting: false, lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString() }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [w] })))
    render(<WorkersClient apiBaseUrl="" />)
    await screen.findByText('Spare laptop')

    expect(screen.getByText('Heartbeat overdue')).toBeDefined()
    expect(screen.getByText(/· Paused/)).toBeDefined()
    expect(screen.getByText(/0 busy · 0 idle · 1 stale · 1 paused/)).toBeDefined()
  })
})
