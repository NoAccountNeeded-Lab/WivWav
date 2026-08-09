/**
 * Offline DOM extraction coverage for evaluateBlvdDetail's gallery strategies
 * (fixes #632).
 *
 * BLVD.com is a marketplace aggregating listings from many independent
 * reseller dealer sites, each potentially on a different site template. The
 * default BLVD template links directly to "_large.jpg" images, but reseller
 * dealer templates (e.g. Freedom Motors, United Access) proxy listings
 * without that naming convention — evaluateBlvdDetail previously had no
 * fallback strategy for them, silently returning imageUrls: [] while
 * detailScrapedAt still advanced as if extraction succeeded.
 *
 * Uses a real, disposable Chromium page with fixture HTML loaded via
 * setContent — no live network — same harness as fixture-contract.test.ts.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PlaywrightBrowserService } from '../browser/index.js'
import type { BrowserPage, BrowserSession } from '../browser/index.js'
import { evaluateBlvdDetail } from './blvd-detail.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contracts')

function fixtureHtml(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8')
}

let session: BrowserSession | undefined

async function openFixture(name: string): Promise<BrowserPage> {
  if (!session) throw new Error('Fixture browser session is not initialized')
  const page = await session.newPage({ failOnExternalRequests: true })
  await page.setContent(fixtureHtml(name), { waitUntil: 'load' })
  return page
}

beforeAll(async () => {
  session = await new PlaywrightBrowserService().launch()
}, 30_000)

afterAll(async () => {
  await session?.close()
})

describe('evaluateBlvdDetail gallery extraction', () => {
  it('extracts the default BLVD template via "_large.jpg" anchors (no regression)', async () => {
    const page = await openFixture('blvd-detail-v1.html')
    try {
      const raw = await evaluateBlvdDetail(page)
      expect(raw.galleryFound).toBe(true)
      expect(raw.imageUrls).toEqual([
        'https://www.blvd.com/fixture-images/blvd-normal-1_large.jpg',
        'https://www.blvd.com/fixture-images/blvd-normal-2_large.jpg',
      ])
    } finally {
      await page.close()
    }
  })

  it('falls back to the reseller carousel container when no "_large.jpg" anchors are present', async () => {
    const page = await openFixture('blvd-detail-reseller-v1.html')
    try {
      const raw = await evaluateBlvdDetail(page)
      expect(raw.galleryFound).toBe(true)
      expect(raw.imageUrls).toEqual([
        'https://www.blvd.com/inventory/photos/fixture-reseller-01.jpg',
        'https://www.blvd.com/inventory/photos/fixture-reseller-02.jpg',
      ])
      // Non-vehicle badge image inside the same carousel container must be excluded.
      expect(raw.imageUrls.some((url) => url.includes('badge'))).toBe(false)
    } finally {
      await page.close()
    }
  })

  it('reports galleryFound: false with no images when no gallery container exists at all', async () => {
    const page = await openFixture('blvd-detail-edge-v1.html')
    try {
      const raw = await evaluateBlvdDetail(page)
      expect(raw.galleryFound).toBe(false)
      expect(raw.imageUrls).toEqual([])
    } finally {
      await page.close()
    }
  })
})
