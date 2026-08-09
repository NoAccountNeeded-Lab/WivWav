import { describe, it, expect, vi } from 'vitest'
import { RobotsCache } from './robots-cache.js'

function makeTextResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response
}

const ALLOW_ALL = 'User-agent: *\nAllow: /'
const DISALLOW_VANS = 'User-agent: *\nDisallow: /wheelchair-vans-for-sale/'
const DISALLOW_ALL = 'User-agent: *\nDisallow: /'

describe('RobotsCache', () => {
  it('allows all URLs when robots.txt returns 404', async () => {
    const fetch = vi.fn().mockResolvedValue(makeTextResponse(404, ''))
    const cache = new RobotsCache(fetch)
    const allowed = await cache.isAllowed('https://example.com/wheelchair-vans-for-sale/')
    expect(allowed).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('allows all URLs when robots.txt fetch fails with a network error', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const cache = new RobotsCache(fetch)
    const allowed = await cache.isAllowed('https://example.com/some/path')
    expect(allowed).toBe(true)
  })

  it('allows a path that is explicitly allowed', async () => {
    const fetch = vi.fn().mockResolvedValue(makeTextResponse(200, ALLOW_ALL))
    const cache = new RobotsCache(fetch)
    expect(await cache.isAllowed('https://example.com/listings')).toBe(true)
  })

  it('disallows a path that is explicitly disallowed', async () => {
    const fetch = vi.fn().mockResolvedValue(makeTextResponse(200, DISALLOW_VANS))
    const cache = new RobotsCache(fetch)
    expect(
      await cache.isAllowed('https://example.com/wheelchair-vans-for-sale/a-vehicle'),
    ).toBe(false)
  })

  it('allows paths not matched by a disallow rule', async () => {
    const fetch = vi.fn().mockResolvedValue(makeTextResponse(200, DISALLOW_VANS))
    const cache = new RobotsCache(fetch)
    expect(await cache.isAllowed('https://example.com/other-page')).toBe(true)
  })

  it('disallows all paths when robots.txt disallows everything', async () => {
    const fetch = vi.fn().mockResolvedValue(makeTextResponse(200, DISALLOW_ALL))
    const cache = new RobotsCache(fetch)
    expect(await cache.isAllowed('https://example.com/anything')).toBe(false)
  })

  it('caches the robots.txt per origin — only one fetch per origin', async () => {
    const fetch = vi.fn().mockResolvedValue(makeTextResponse(200, ALLOW_ALL))
    const cache = new RobotsCache(fetch)

    await cache.isAllowed('https://example.com/page1')
    await cache.isAllowed('https://example.com/page2')
    await cache.isAllowed('https://example.com/page3')

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://example.com/robots.txt')
  })

  it('fetches separately for different origins', async () => {
    const fetch = vi.fn().mockResolvedValue(makeTextResponse(200, ALLOW_ALL))
    const cache = new RobotsCache(fetch)

    await cache.isAllowed('https://example.com/page')
    await cache.isAllowed('https://other.com/page')

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('clear() flushes the cache so the next request refetches', async () => {
    const fetch = vi.fn().mockResolvedValue(makeTextResponse(200, ALLOW_ALL))
    const cache = new RobotsCache(fetch)

    await cache.isAllowed('https://example.com/page')
    cache.clear()
    await cache.isAllowed('https://example.com/page')

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns true for a malformed URL', async () => {
    const fetch = vi.fn()
    const cache = new RobotsCache(fetch)
    const allowed = await cache.isAllowed('not-a-url')
    expect(allowed).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
})
