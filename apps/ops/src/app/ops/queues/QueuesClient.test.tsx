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
