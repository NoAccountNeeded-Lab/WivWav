// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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
