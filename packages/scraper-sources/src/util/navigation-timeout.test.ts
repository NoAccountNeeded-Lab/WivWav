import { describe, it, expect, vi } from 'vitest'
import { isNavigationTimeout, withNavigationRetry } from './navigation-timeout.js'

// ─── isNavigationTimeout ─────────────────────────────────────────────────────

describe('isNavigationTimeout', () => {
  it('detects Playwright navigation timeout errors', () => {
    expect(isNavigationTimeout(new Error('page.goto: Timeout 30000ms exceeded.'))).toBe(true)
    expect(isNavigationTimeout(new Error('page.waitForSelector: Timeout 15000ms exceeded.'))).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isNavigationTimeout(new Error('net::ERR_ABORTED'))).toBe(false)
    expect(isNavigationTimeout(new Error('net::ERR_CONNECTION_REFUSED'))).toBe(false)
  })

  it('does not match non-Error values', () => {
    expect(isNavigationTimeout('Timeout 30000ms exceeded')).toBe(false)
    expect(isNavigationTimeout(null)).toBe(false)
    expect(isNavigationTimeout(42)).toBe(false)
  })
})

// ─── withNavigationRetry ─────────────────────────────────────────────────────

describe('withNavigationRetry', () => {
  it('returns the result immediately when the action succeeds on the first attempt', async () => {
    const action = vi.fn().mockResolvedValue('ok')
    const result = await withNavigationRetry(action, 3, 0)
    expect(result).toBe('ok')
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('retries on a timeout error and succeeds on the second attempt', async () => {
    const timeoutErr = new Error('page.goto: Timeout 30000ms exceeded.')
    const action = vi.fn()
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValue('ok')

    const result = await withNavigationRetry(action, 3, 0)
    expect(result).toBe('ok')
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('exhausts all attempts and rethrows the last timeout error', async () => {
    const timeoutErr = new Error('page.goto: Timeout 30000ms exceeded.')
    const action = vi.fn().mockRejectedValue(timeoutErr)

    await expect(withNavigationRetry(action, 3, 0)).rejects.toThrow('Timeout 30000ms exceeded')
    expect(action).toHaveBeenCalledTimes(3)
  })

  it('re-throws a non-timeout error immediately without retrying', async () => {
    const netErr = new Error('net::ERR_CONNECTION_REFUSED')
    const action = vi.fn().mockRejectedValue(netErr)

    await expect(withNavigationRetry(action, 3, 0)).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
    expect(action).toHaveBeenCalledTimes(1)
  })
})
