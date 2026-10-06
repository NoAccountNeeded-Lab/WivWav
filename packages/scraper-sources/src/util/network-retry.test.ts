import { describe, it, expect, vi } from 'vitest'
import { isTransientNetworkError, withTransientNetworkRetry } from './network-retry.js'

const noSleep = (): Promise<void> => Promise.resolve()

describe('isTransientNetworkError', () => {
  it('recognises dropped connections and timeouts', () => {
    expect(isTransientNetworkError(new Error('socket hang up'))).toBe(true)
    expect(isTransientNetworkError(Object.assign(new Error('read failed'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isTransientNetworkError(new Error('[mobility-van-sales] Request timed out after 15000ms for https://x'))).toBe(true)
  })

  it('does not treat other errors as transient', () => {
    expect(isTransientNetworkError(new Error('[mobility-van-sales] Refusing cross-host redirect'))).toBe(false)
    expect(isTransientNetworkError(new TypeError('x is not a function'))).toBe(false)
    expect(isTransientNetworkError('socket hang up')).toBe(false)
  })
})

describe('withTransientNetworkRetry', () => {
  it('retries a transient failure and returns the eventual result', async () => {
    const action = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce('ok')
    await expect(withTransientNetworkRetry(action, { sleep: noSleep })).resolves.toBe('ok')
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('rethrows the last error once attempts are exhausted', async () => {
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('socket hang up'))
    await expect(withTransientNetworkRetry(action, { maxAttempts: 3, sleep: noSleep })).rejects.toThrow('socket hang up')
    expect(action).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-transient errors', async () => {
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('Refusing cross-host redirect'))
    await expect(withTransientNetworkRetry(action, { sleep: noSleep })).rejects.toThrow('cross-host')
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('bounds the added delay per request', async () => {
    const delays: number[] = []
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('socket hang up'))
    await expect(
      withTransientNetworkRetry(action, { sleep: (ms) => { delays.push(ms); return Promise.resolve() } }),
    ).rejects.toThrow()
    expect(delays).toHaveLength(2)
    expect(delays.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10_000)
  })
})
