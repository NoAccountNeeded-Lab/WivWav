import { describe, expect, it, vi, afterEach } from 'vitest'
import { fetchWithTimeout } from './fetch-with-timeout'

describe('fetchWithTimeout', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('forwards request options and returns the response', async () => {
    const fakeResponse = new Response(JSON.stringify({ ok: true }), { status: 200 })
    globalThis.fetch = vi.fn(async (_url, init) => fakeResponse) as typeof globalThis.fetch

    const res = await fetchWithTimeout('http://example.com/test', { method: 'POST' }, 1000)

    expect(res).toBe(fakeResponse)
    expect(globalThis.fetch).toHaveBeenCalledWith('http://example.com/test', expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }))
  })

  it('aborts the request after the timeout', async () => {
    globalThis.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as typeof globalThis.fetch

    await expect(fetchWithTimeout('http://example.com/slow', {}, 1)).rejects.toThrow('aborted')
  })
})
