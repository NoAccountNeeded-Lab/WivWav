// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RefreshListingsClient } from './RefreshListingsClient'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RefreshListingsClient progress', () => {
  it('renders count-backed workflow and detail progress from mocked API data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/admin/listing-refresh/status')) {
        return jsonResponse({
          data: {
            generatedAt: '2026-07-12T09:00:00.000Z',
            sources: {
              total: 2,
              active: 2,
              needsAttention: 0,
              totalListings: 20,
              observedActiveListings: 20,
              eligibleListings: 5,
              lastScrapedAt: '2026-07-12T08:00:00.000Z',
            },
            listings: {
              active: 20,
              observedActive: 20,
              eligible: 5,
              mapReady: 18,
              missingLocations: 2,
            },
            latestScrapeRun: null,
            queues: [
              { name: 'source-scrape', paused: false, stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }, lastJobAt: null, lastFinishedAt: null, lastStatus: null, recentFailureCount: 0, recentFailureReason: null },
              { name: 'detail-crawl', paused: false, stats: { waiting: 2, active: 1, completed: 1, failed: 0, delayed: 0 }, lastJobAt: null, lastFinishedAt: null, lastStatus: null, recentFailureCount: 0, recentFailureReason: null },
              { name: 'detail-extract', paused: false, stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }, lastJobAt: null, lastFinishedAt: null, lastStatus: null, recentFailureCount: 0, recentFailureReason: null },
              { name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }, lastJobAt: null, lastFinishedAt: null, lastStatus: null, recentFailureCount: 0, recentFailureReason: null },
            ],
          },
        })
      }

      if (url.endsWith('/admin/sources')) {
        return jsonResponse({ data: [{ id: 'src-1', name: 'BLVD', status: 'active' }] })
      }

      if (url.endsWith('/health')) {
        return jsonResponse({
          services: {
            meilisearch: { status: 'up' },
            valkey: { status: 'up' },
            scraper: { status: 'up' },
          },
        })
      }

      throw new Error(`Unexpected URL in test: ${url}`)
    }))

    const { container } = render(<RefreshListingsClient apiBaseUrl="" />)

    const workflowBar = await screen.findByRole('progressbar', { name: 'Listing refresh workflow progress' })
    expect(workflowBar.getAttribute('aria-valuenow')).toBe('1')
    expect(workflowBar.getAttribute('aria-valuemax')).toBe('5')

    const detailBar = await screen.findByRole('progressbar', { name: 'Process details progress' })
    expect(detailBar.getAttribute('aria-valuenow')).toBe('1')
    expect(detailBar.getAttribute('aria-valuemax')).toBe('4')

    await waitFor(() => {
      expect(screen.getByText('1 of 5 steps complete')).toBeDefined()
      expect(screen.getByText('1 of 4 visible detail jobs settled')).toBeDefined()
    })

    const fills = [...container.querySelectorAll('[class*="fill"]')] as HTMLElement[]
    expect(fills.some(fill => fill.style.width === '20%')).toBe(true)
    expect(fills.some(fill => fill.style.width === '25%')).toBe(true)
  })
})
