import { describe, it, expect } from 'vitest'
import { MockBrowserService } from './mock-browser-service.js'
import type { MockPageRecord, MockBrowserPage, MockBrowserSession } from './mock-browser-service.js'

describe('MockBrowserService', () => {
  it('launch() returns a new session each time', async () => {
    const service = new MockBrowserService()
    const s1 = await service.launch()
    const s2 = await service.launch()
    expect(s1).not.toBe(s2)
    expect(service.sessions).toHaveLength(2)
  })

  it('newPage() returns a page that responds to goto with the configured status code', async () => {
    const pages = new Map<string, MockPageRecord>([
      ['https://example.com/', { url: 'https://example.com/', html: '<html></html>', statusCode: 200 }],
      ['https://gone.com/', { url: 'https://gone.com/', html: '', statusCode: 404 }],
    ])
    const service = new MockBrowserService(pages)
    const session = await service.launch()
    const page = await session.newPage()

    const res200 = await page.goto('https://example.com/')
    expect(res200?.status()).toBe(200)

    const res404 = await page.goto('https://gone.com/')
    expect(res404?.status()).toBe(404)
  })

  it('content() returns the HTML set by goto()', async () => {
    const pages = new Map<string, MockPageRecord>([
      ['https://example.com/', { url: 'https://example.com/', html: '<html>hello</html>', statusCode: 200 }],
    ])
    const service = new MockBrowserService(pages)
    const session = await service.launch()
    const page = await session.newPage()

    await page.goto('https://example.com/')
    expect(await page.content()).toBe('<html>hello</html>')
  })

  it('content() returns the default HTML for unknown URLs', async () => {
    const service = new MockBrowserService(new Map(), '<html>default</html>')
    const session = await service.launch()
    const page = await session.newPage()

    await page.goto('https://unknown.com/')
    expect(await page.content()).toBe('<html>default</html>')
  })

  it('setContent() overrides the page HTML', async () => {
    const service = new MockBrowserService()
    const session = await service.launch()
    const page = await session.newPage()

    await page.setContent('<html>injected</html>')
    expect(await page.content()).toBe('<html>injected</html>')
  })

  it('url() returns the last navigated URL', async () => {
    const service = new MockBrowserService()
    const session = await service.launch()
    const page = await session.newPage()

    await page.goto('https://nav.com/')
    expect(page.url()).toBe('https://nav.com/')
  })

  it('evaluate() without args calls the function and returns its result', async () => {
    const service = new MockBrowserService()
    const session = await service.launch()
    const page = await session.newPage()

    const result = await page.evaluate(function () { return 42 })
    expect(result).toBe(42)
  })

  it('evaluate() with arg passes the arg through', async () => {
    const service = new MockBrowserService()
    const session = await service.launch()
    const page = await session.newPage()

    const result = await page.evaluate(function (n: number) { return n * 2 }, 21)
    expect(result).toBe(42)
  })

  it('close() marks the page as closed', async () => {
    const service = new MockBrowserService()
    const session = await service.launch()
    const page = await session.newPage() as MockBrowserPage

    expect(page.closed).toBe(false)
    await page.close()
    expect(page.closed).toBe(true)
  })

  it('close() marks the session as closed', async () => {
    const service = new MockBrowserService()
    const session = await service.launch() as MockBrowserSession

    expect(session.closed).toBe(false)
    await session.close()
    expect(session.closed).toBe(true)
  })

  it('records calls to goto()', async () => {
    const service = new MockBrowserService()
    const session = await service.launch()
    const page = await session.newPage() as MockBrowserPage

    await page.goto('https://a.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 })

    expect(page.calls.goto).toHaveLength(1)
    expect(page.calls.goto[0]).toEqual({
      url: 'https://a.com/',
      options: { waitUntil: 'domcontentloaded', timeout: 30_000 },
    })
  })
})
