import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { CrawledHtmlPage, PageFetcher } from '../crawlee/html-fetcher.js'
import { MockBrowserService } from '../browser/mock-browser-service.js'
import { RobotsCache } from '../util/robots-cache.js'
import { BlvdAdapter, hasBlvdNextPage, extractBlvdStructure, hashPage1Entries } from './blvd.js'

const { load } = createRequire(import.meta.url)('cheerio') as { load(html: string): CrawledHtmlPage['$'] }
const html = readFileSync(new URL('./fixtures/contracts/blvd-list-v1.html', import.meta.url), 'utf8')
const robotsCache = { async isAllowed() { return true }, clear() {} } as unknown as RobotsCache
const options = { robotsCache, requestDelayMs: 0, maxPages: 1 }
function makeFetcher(body = html, statusCode = 200): PageFetcher {
  return {
    fetchOne: vi.fn(async (url: string) => ({ url, body, $: load(body), statusCode })),
    async crawl() { throw new Error('not used') },
  }
}

describe('BLVD pluggable fetching', () => {
  it('runs all three listing methods without launching a configured browser', async () => {
    const browserService = new MockBrowserService()
    const launch = vi.spyOn(browserService, 'launch')
    const adapter = new BlvdAdapter(null, { ...options, pageFetcher: makeFetcher(), browserService })
    expect((await adapter.checkPage1()).currentHash).toHaveLength(64)
    expect((await adapter.checkStructure()).currentHash).toHaveLength(64)
    expect((await adapter.scrape()).listings.length).toBeGreaterThan(0)
    expect(launch).not.toHaveBeenCalled()
  })

  it('preserves path-specific ID/price hashing', async () => {
    const body = '<div class="track_vehicle" data-id="42"><div class="vlistp">Price</div><h4>$99</h4></div>'
    const adapter = new BlvdAdapter(null, { ...options, pageFetcher: makeFetcher(body) })
    expect((await adapter.checkPage1()).currentHash).toBe(hashPage1Entries([
      '/wheelchair-vans-for-sale:42:$99', '/wheelchair-vans-for-sale-by-owner:42:$99',
    ]))
  })

  it.each(['checkPage1', 'checkStructure', 'scrape'] as const)('falls back once on blocked responses in %s', async (method) => {
    const browserService = new MockBrowserService(new Map(), html)
    const adapter = new BlvdAdapter(null, {
      ...options, pageFetcher: makeFetcher('<html>Just a moment</html>', 403), browserService,
    })
    await adapter[method]()
    expect(browserService.sessions.length).toBe(method === 'checkStructure' ? 1 : 2)
    expect(browserService.sessions.every((s) => s.closed)).toBe(true)
  })

  it('fails clearly when blocked and no fallback browser is configured', async () => {
    const adapter = new BlvdAdapter(null, { ...options, pageFetcher: makeFetcher('', 429) })
    await expect(adapter.scrape()).rejects.toThrow('Chromium fallback unavailable or blocked')
  })

  it('rejects a still-blocked browser response without looping', async () => {
    const browserService = new MockBrowserService(new Map(), '<html>Just a moment</html>')
    const adapter = new BlvdAdapter(null, { ...options, pageFetcher: makeFetcher('', 503), browserService })
    await expect(adapter.scrape()).rejects.toThrow('cloudflare_challenge')
    expect(browserService.sessions).toHaveLength(1)
    expect(browserService.sessions[0]?.closed).toBe(true)
  })

  it('does not turn a later-page block into successful partial results', async () => {
    const pageFetcher = makeFetcher()
    pageFetcher.fetchOne = vi.fn(async (url: string) => {
      const body = url.includes('?page=') ? '' : `${html}<a>Next</a>`
      return { url, body, $: load(body), statusCode: url.includes('?page=') ? 403 : 200 }
    })
    const adapter = new BlvdAdapter(null, { ...options, maxPages: 2, pageFetcher })
    await expect(adapter.scrape()).rejects.toThrow('Blocked fetching')
  })

  it('honors robots before fetching for structure/page-one checks', async () => {
    const pageFetcher = makeFetcher()
    const disallow = { async isAllowed() { return false }, clear() {} } as unknown as RobotsCache
    const adapter = new BlvdAdapter(null, { ...options, robotsCache: disallow, pageFetcher })
    await expect(adapter.checkPage1()).rejects.toThrow('robots.txt disallows')
    await expect(adapter.checkStructure()).rejects.toThrow('robots.txt disallows')
    expect(pageFetcher.fetchOne).not.toHaveBeenCalled()
  })

  it('requires the exact trimmed Next anchor text', () => {
    expect(hasBlvdNextPage(load('<a> Next </a>'))).toBe(true)
    expect(hasBlvdNextPage(load('<a>Next page</a><button>Next</button>'))).toBe(false)
  })

  it('uses the existing no-cards signature for an empty page', () => {
    expect(extractBlvdStructure(load(''))).toEqual({ signature: 'no-cards', cardHtml: '' })
  })
})


describe('BLVD fallback pacing', () => {
  it('honors robots crawl-delay before the browser fallback', async () => {
    const robotsCache = new RobotsCache(async () => new Response('User-agent: *\nCrawl-delay: 0.1\nAllow: /\n'))
    let fetchedAt = 0
    let launchedAt = 0
    const pageFetcher = makeFetcher('', 403)
    const fetchOne = pageFetcher.fetchOne.bind(pageFetcher)
    pageFetcher.fetchOne = async (url) => { fetchedAt = Date.now(); return fetchOne(url) }
    const browserService = new MockBrowserService(new Map(), html)
    const launch = browserService.launch.bind(browserService)
    browserService.launch = async () => { launchedAt = Date.now(); return launch() }
    await new BlvdAdapter(null, { ...options, robotsCache, pageFetcher, browserService }).checkStructure()
    expect(launchedAt - fetchedAt).toBeGreaterThanOrEqual(99)
  })
})
