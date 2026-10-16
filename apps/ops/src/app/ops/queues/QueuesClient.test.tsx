// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueuesClient } from './QueuesClient'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('QueuesClient progress', () => {
  it('renders count-backed queue snapshot progress from mocked API data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/admin/queues')) {
        return jsonResponse({
          data: [{
            name: 'detail-crawl',
            paused: false,
            stats: { waiting: 2, active: 1, delayed: 1, completed: 5, failed: 1 },
            policy: { concurrency: 1, retention: { completed: 25, failed: 25 } },
          }],
        })
      }

      throw new Error(`Unexpected URL in test: ${url}`)
    }))

    const { container } = render(<QueuesClient apiBaseUrl="" />)

    const progressBar = await screen.findByRole('progressbar', { name: 'detail-crawl queue snapshot progress' })
    expect(progressBar.getAttribute('aria-valuenow')).toBe('6')
    expect(progressBar.getAttribute('aria-valuemax')).toBe('10')
    expect(await screen.findByText('6 of 10 visible jobs settled')).toBeDefined()

    const fills = [...container.querySelectorAll('[class*="fill"]')] as HTMLElement[]
    expect(fills.some(fill => fill.style.width === '60%')).toBe(true)
  })
})

describe('QueuesClient action icons (#764)', () => {
  it('renders a leading icon on the Pause, Trigger, Activity, and Refresh buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/admin/queues')) {
        return jsonResponse({
          data: [{
            name: 'detail-crawl',
            paused: false,
            stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
            policy: { concurrency: 1, retention: { completed: 25, failed: 25 } },
          }],
        })
      }

      throw new Error(`Unexpected URL in test: ${url}`)
    }))

    render(<QueuesClient apiBaseUrl="" />)

    const pauseBtn = await screen.findByRole('button', { name: 'Pause' })
    expect(pauseBtn.querySelector('svg.lucide-pause')).not.toBeNull()

    const triggerBtn = screen.getByRole('button', { name: 'Trigger' })
    expect(triggerBtn.querySelector('svg.lucide-zap')).not.toBeNull()

    const activityBtn = screen.getByRole('button', { name: 'Activity' })
    expect(activityBtn.querySelector('svg.lucide-activity')).not.toBeNull()

    const refreshBtn = screen.getByRole('button', { name: 'Refresh' })
    expect(refreshBtn.querySelector('svg.lucide-refresh-cw')).not.toBeNull()
  })

  it('renders a distinct Resume icon from Pause on a paused queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/admin/queues')) {
        return jsonResponse({
          data: [{
            name: 'detail-crawl',
            paused: true,
            stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
            policy: { concurrency: 1, retention: { completed: 25, failed: 25 } },
          }],
        })
      }

      throw new Error(`Unexpected URL in test: ${url}`)
    }))

    render(<QueuesClient apiBaseUrl="" />)

    const resumeBtn = await screen.findByRole('button', { name: 'Resume' })
    expect(resumeBtn.querySelector('svg.lucide-play')).not.toBeNull()
    expect(resumeBtn.querySelector('svg.lucide-pause')).toBeNull()
  })
})

describe('QueuesClient per-job controls (#1152)', () => {
  const job = (id: string, status: string) => ({
    id, name: 'detail-crawl', data: {}, status, createdAt: '2026-10-16T12:00:00.000Z',
    attemptsMade: 1, progress: 0, logs: [],
  })

  function setup(actionStatus = 200, actionBody: unknown = { data: { message: 'Moved back to waiting with attempts reset.' } }) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return { ok: actionStatus < 300, status: actionStatus, json: async () => actionBody } as Response
      }
      if (url.endsWith('/admin/queues')) {
        return jsonResponse({
          data: [{
            name: 'detail-crawl', paused: false,
            stats: { waiting: 1, active: 1, completed: 0, failed: 1, delayed: 1 },
            policy: { concurrency: 1, retention: { completed: 25, failed: 25 } },
          }],
        })
      }
      if (url.endsWith('/admin/queues/detail-crawl')) {
        return jsonResponse({
          data: {
            name: 'detail-crawl', paused: false,
            stats: { waiting: 1, active: 1, completed: 0, failed: 1, delayed: 1 },
            policy: { concurrency: 1, retention: { completed: 25, failed: 25 } },
            jobs: [job('w1', 'waiting'), job('d1', 'delayed'), job('a1', 'active'), job('f1', 'failed')],
          },
        })
      }
      throw new Error(`Unexpected URL in test: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  async function openActivity() {
    render(<QueuesClient apiBaseUrl="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    await screen.findByText('#w1')
  }

  it('shows only the buttons that fit each job state', async () => {
    setup()
    await openActivity()
    expect(screen.getByRole('button', { name: 'Cancel job #w1' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Retry job #w1' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel job #d1' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Make job #d1 ready now' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /job #a1/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry job #f1' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Cancel job #f1' })).toBeNull()
  })

  it('confirms in-page before cancelling, then posts to the guarded route', async () => {
    const fetchMock = setup(200, { data: { message: 'Removed the queued attempt only.' } })
    await openActivity()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel job #w1' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect(screen.getByText(/does not stop a worker already running it/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Remove job' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/internal/ops/queues/detail-crawl/jobs/w1/cancel', { method: 'POST' },
    ))
    expect(await screen.findByText('Removed the queued attempt only.')).toBeDefined()
  })

  it('shows a visible message on 409', async () => {
    setup(409, { error: { code: 'JOB_CONFLICT', message: 'Job is active, not failed' } })
    await openActivity()
    fireEvent.click(screen.getByRole('button', { name: 'Retry job #f1' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Job #f1 was not changed')
    expect(alert.textContent).toContain('Job is active, not failed')
  })
})
