// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SafetyRefreshButton } from './SafetyRefreshButton'

const { refresh, useRouter } = vi.hoisted(() => ({ refresh: vi.fn(), useRouter: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

beforeEach(() => {
  useRouter.mockReturnValue({ refresh })
})

function renderButton() {
  render(<SafetyRefreshButton listingId="listing-1" apiBaseUrl="https://api.example.test" />)
}

describe('SafetyRefreshButton', () => {
  it('shows loading while the refresh request is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh safety data' }))

    expect(screen.getByText('Refreshing…')).toBeDefined()
  })

  it('schedules a router refresh after a successful refresh request', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { enqueued: true } }),
    }))
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh safety data' }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Refresh queued')).toBeDefined()
    await act(async () => { vi.advanceTimersByTime(15_000) })

    expect(refresh).toHaveBeenCalledOnce()
  })

  it('shows the retry timing for rate-limited refresh requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { enqueued: false, reason: 'rate-limited', retryAfter: 121 } }),
    }))
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh safety data' }))

    expect(await screen.findByText('Refresh requested recently — check back in ~3m')).toBeDefined()
  })

  it('shows a generic failure message when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh safety data' }))

    expect(await screen.findByText('Refresh failed — try again later')).toBeDefined()
  })
})
