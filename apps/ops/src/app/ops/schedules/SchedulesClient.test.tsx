// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SchedulesClient } from './SchedulesClient'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function scheduleEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sched-1',
    queue: 'source-scrape',
    jobId: null,
    label: 'Nightly scrape',
    name: 'source-scrape',
    data: {},
    defaultPattern: '0 2 * * *',
    tz: 'UTC',
    enabled: true,
    key: 'source-scrape:::0 2 * * *',
    pattern: '0 2 * * *',
    next: null,
    lastRunAt: null,
    lastStatus: null,
    recentFailureCount: 0,
    recentFailureReason: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SchedulesClient action icons (#764)', () => {
  it('renders a leading icon on the Disable, Edit, and Refresh buttons for an enabled schedule', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/admin/repeatables')) {
        return jsonResponse({ data: [scheduleEntry({ enabled: true })] })
      }
      throw new Error(`Unexpected URL in test: ${url}`)
    }))

    render(<SchedulesClient apiBaseUrl="" />)

    const disableBtn = await screen.findByRole('button', { name: 'Disable' })
    expect(disableBtn.querySelector('svg.lucide-circle-x')).not.toBeNull()

    const editBtn = screen.getByRole('button', { name: 'Edit' })
    expect(editBtn.querySelector('svg.lucide-pencil')).not.toBeNull()

    const refreshBtn = screen.getByRole('button', { name: 'Refresh' })
    expect(refreshBtn.querySelector('svg.lucide-refresh-cw')).not.toBeNull()
  })

  it('renders a distinct Enable icon from Disable for a disabled schedule', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/admin/repeatables')) {
        return jsonResponse({ data: [scheduleEntry({ enabled: false, key: null })] })
      }
      throw new Error(`Unexpected URL in test: ${url}`)
    }))

    render(<SchedulesClient apiBaseUrl="" />)

    const enableBtn = await screen.findByRole('button', { name: 'Enable' })
    expect(enableBtn.querySelector('svg.lucide-circle-check')).not.toBeNull()
    expect(enableBtn.querySelector('svg.lucide-circle-x')).toBeNull()
  })
})
