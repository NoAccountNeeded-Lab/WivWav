import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchWithRetry } from './fetch-with-retry.js'

function makeResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
  } as Response
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('fetchWithRetry', () => {
  it('returns the response immediately on success', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(200))
    const res = await fetchWithRetry('https://example.com')
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 and eventually succeeds', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(200))

    const res = await fetchWithRetry('https://example.com', undefined, {
      retries: 3,
      minTimeout: 1,
    })
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('retries on 503 and eventually succeeds', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200))

    const res = await fetchWithRetry('https://example.com', undefined, {
      retries: 3,
      minTimeout: 1,
    })
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(404))
    await expect(fetchWithRetry('https://example.com', undefined, { retries: 3, minTimeout: 1 }))
      .rejects.toThrow('HTTP 404')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(401))
    await expect(fetchWithRetry('https://example.com', undefined, { retries: 3, minTimeout: 1 }))
      .rejects.toThrow('HTTP 401')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects after exhausting all retries on persistent 5xx', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeResponse(500))
    await expect(fetchWithRetry('https://example.com', undefined, { retries: 2, minTimeout: 1 }))
      .rejects.toThrow()
    // initial + 2 retries = 3 total
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('retries on network-level failure and eventually succeeds', async () => {
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(makeResponse(200))

    const res = await fetchWithRetry('https://example.com', undefined, {
      retries: 2,
      minTimeout: 1,
    })
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('honours Retry-After header on 429', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => {
      ;(fn as () => void)()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(makeResponse(200))

    await fetchWithRetry('https://example.com', undefined, { retries: 2, minTimeout: 1 })

    // setTimeout was called for the Retry-After delay (1 second = 1000ms)
    const retryAfterCall = setTimeoutSpy.mock.calls.find(([, ms]) => (ms as number) >= 1000)
    expect(retryAfterCall).toBeDefined()
  })
})
