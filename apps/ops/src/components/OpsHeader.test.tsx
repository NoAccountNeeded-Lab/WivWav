// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAnnouncementDelay, OpsHeader } from './OpsHeader'

const mockUsePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

vi.mock('./ThemePicker', () => ({
  ThemePicker: () => <button type="button">Theme picker</button>,
}))

describe('OpsHeader', () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue('/ops/queues')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('should derive the section title from the current route and show the live health status pill', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 'degraded',
        timestamp: '2026-07-11T18:00:00.000Z',
        services: {
          postgres: { status: 'up' },
          meilisearch: { status: 'up' },
          valkey: { status: 'up' },
          ollama: { status: 'optional_offline' },
          scraper: { status: 'degraded' },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ))

    render(<OpsHeader />)

    expect(screen.getByText('Advanced queue diagnostics')).toBeDefined()
    const statusLink = await screen.findByRole('link', { name: /overall operational status: degraded/i })
    expect(statusLink.getAttribute('href')).toBe('/ops/readiness')
  })

  it('should fall back to an unavailable status without blanking the header when health fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    render(<OpsHeader sectionTitle="System status" />)

    expect(screen.getByRole('link', { name: /wivwav ops/i })).toBeDefined()
    expect(screen.getByText('System status')).toBeDefined()

    const statusLink = await screen.findByRole('link', { name: /overall operational status: status unavailable/i })
    expect(statusLink).toBeDefined()
  })

  it('should compute the remaining polite-announcement delay when updates happen too close together', () => {
    expect(getAnnouncementDelay(30_000, 10_000, 12_000)).toBe(0)
    expect(getAnnouncementDelay(15_000, 10_000, 12_000)).toBe(7_000)
  })
})
