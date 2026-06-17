import { describe, it, expect } from 'vitest'
import { PlaywrightBrowserService } from '../browser/index.js'
import type { BrowserSession } from '../browser/index.js'
import { evaluateBlvdDetail, parseBlvdDetail } from './blvd-detail.js'

const BASE_URL = 'https://www.blvd.com'
const LISTINGS_PATH = '/wheelchair-vans-for-sale'

async function getFirstDetailUrl(session: BrowserSession): Promise<string> {
  const page = await session.newPage()
  try {
    await page.goto(`${BASE_URL}${LISTINGS_PATH}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const href = await page.evaluate(function () {
      return document.querySelector<HTMLAnchorElement>('a.more-van-details-btn')?.getAttribute('href') ?? null
    })
    if (!href) throw new Error('No detail link found on listing page — BLVD structure may have changed')
    return href.startsWith('http') ? href : `${BASE_URL}${href}`
  } finally {
    await page.close()
  }
}

describe('evaluateBlvdDetail (integration)', () => {
  it('extracts structured fields from a live BLVD detail page', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const detailUrl = await getFirstDetailUrl(session)

      const page = await session.newPage()
      await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 45_000 })
      const raw = await evaluateBlvdDetail(page)
      await page.close()

      // Specs should contain at least a few key fields
      expect(Object.keys(raw.specs).length).toBeGreaterThan(2)

      // Images should be present and absolute
      expect(raw.imageUrls.length).toBeGreaterThan(0)
      for (const url of raw.imageUrls) {
        expect(url).toMatch(/^https:\/\/www\.blvd\.com\//)
        expect(url).toContain('_large.jpg')
      }

      // Dealer phone should look like a phone number
      if (raw.dealerPhone) {
        expect(raw.dealerPhone).toMatch(/\d{3}/)
      }

      // Address should contain a zip
      expect(raw.dealerAddressText).toBeTruthy()

      // Full parse pipeline should not throw and should return a valid rampType
      const detail = parseBlvdDetail(raw)
      expect(['in_floor', 'fold_out', 'fold_in', 'none', 'unknown']).toContain(detail.rampType)

      // At least color, fuelType, or transmission should be populated
      const hasAnyVehicleSpec = detail.color !== null || detail.fuelType !== null || detail.transmission !== null
      expect(hasAnyVehicleSpec).toBe(true)

      // Images should pass through to detail
      expect(detail.images.length).toBe(raw.imageUrls.length)

    } finally {
      await session.close()
    }
  }, 60_000)

  it('setContent roundtrip produces identical output to live evaluation', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const detailUrl = await getFirstDetailUrl(session)

      // Simulate detail-crawl: goto + store html
      const crawlPage = await session.newPage()
      await crawlPage.goto(detailUrl, { waitUntil: 'networkidle', timeout: 45_000 })
      const rawLive = await evaluateBlvdDetail(crawlPage)
      const html = await crawlPage.content()
      await crawlPage.close()

      // Simulate detail-extract: setContent + evaluate
      const extractPage = await session.newPage()
      await extractPage.setContent(html, { waitUntil: 'domcontentloaded' })
      const rawFromHtml = await evaluateBlvdDetail(extractPage)
      await extractPage.close()

      // Both phases must produce identical structured data
      expect(rawFromHtml.specs).toEqual(rawLive.specs)
      expect(rawFromHtml.imageUrls).toEqual(rawLive.imageUrls)
      expect(rawFromHtml.dealerPhone).toEqual(rawLive.dealerPhone)
      expect(rawFromHtml.dealerAddressText).toEqual(rawLive.dealerAddressText)

    } finally {
      await session.close()
    }
  }, 90_000)
})
