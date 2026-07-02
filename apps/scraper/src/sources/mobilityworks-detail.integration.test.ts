/**
 * Fixture-driven integration tests for evaluateMwDetail.
 *
 * These tests use Playwright's real browser engine to exercise the
 * page.evaluate() extraction logic against versioned HTML fixture files.
 * They verify that the extraction logic produces the expected RawMwDetail
 * output — including descriptionFound/galleryFound flags — without live
 * network access.
 *
 * Excluded from the normal `pnpm test` run (integration.test.ts pattern).
 * Run with: pnpm --filter=@wivwav/scraper exec vitest run src --include src/sources/mobilityworks-detail.integration.test.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PlaywrightBrowserService } from '../browser/index.js'
import { evaluateMwDetail, parseMwDetail } from './mobilityworks-detail.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(__dirname, 'fixtures')

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf-8')
}

describe('evaluateMwDetail — fixture-driven (mw-v1: description success)', () => {
  it('finds descriptionFound: true and extracts vehicle description from bounded section', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v1-description-success.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      expect(raw.descriptionFound).toBe(true)
      expect(raw.descriptionText).toContain('BraunAbility in-floor ramp')
      expect(raw.descriptionText).toContain('14 inch floor lowering')
      // Must not contain financing disclaimer text
      expect(raw.descriptionText).not.toContain('financing options')
      expect(raw.descriptionText).not.toContain('credit approval')
    } finally {
      await session.close()
    }
  }, 30_000)

  it('finds galleryFound: true and collects vehicle images from gallery container', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v1-description-success.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      expect(raw.galleryFound).toBe(true)
      expect(raw.imageUrls.length).toBeGreaterThan(0)
      // All URLs should be vehicle images from the gallery
      for (const url of raw.imageUrls) {
        expect(url).toMatch(/cdn\.mobilityworks\.com\/vehicles\//)
        expect(url).toMatch(/\.(jpg|jpeg|webp|png)$/i)
      }
      // Must not include social icons from site footer
      expect(raw.imageUrls.every((u) => !u.includes('/social/'))).toBe(true)
      expect(raw.imageUrls.every((u) => !u.includes('/badge/'))).toBe(true)
    } finally {
      await session.close()
    }
  }, 30_000)

  it('extracts specs with Fuel Type (not Engine) and parses detail fields', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v1-description-success.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      expect(raw.specs['Fuel Type']).toBe('Hybrid')
      expect(raw.specs['Engine']).toBe('2.5L Hybrid I4')

      const detail = parseMwDetail(raw)
      expect(detail.fuelType).toBe('Hybrid')
      // Engine text must not appear as fuelType
      expect(detail.fuelType).not.toBe('2.5L Hybrid I4')
      expect(detail.rampType).toBe('in_floor')
      expect(detail.floorLoweringInches).toBe(14)
      expect(detail.wavFeatures).toContain('power_ramp')
      expect(detail.wavFeatures).toContain('automatic_door')
      expect(detail.wavFeatures).toContain('tie_down_system')
    } finally {
      await session.close()
    }
  }, 30_000)
})

describe('evaluateMwDetail — fixture-driven (mw-v2: description missing)', () => {
  it('returns descriptionFound: false when no vehicle description section exists on page', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v2-description-missing.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      expect(raw.descriptionFound).toBe(false)
      // descriptionText should be empty — not the disclaimer paragraph text
      expect(raw.descriptionText).toBe('')
      // Must not have picked up disclaimer or about-us paragraphs
      expect(raw.descriptionText).not.toContain('prices exclude tax')
      expect(raw.descriptionText).not.toContain('nation\'s leading wheelchair')
    } finally {
      await session.close()
    }
  }, 30_000)

  it('parseMwDetail returns null description when descriptionFound is false', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v2-description-missing.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      const detail = parseMwDetail(raw)
      expect(detail.description).toBeNull()
      // WAV features derived from description should also be empty
      expect(detail.wavFeatures).toEqual([])
      expect(detail.rampType).toBe('unknown')
    } finally {
      await session.close()
    }
  }, 30_000)

  it('still finds the gallery when it exists despite missing description', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v2-description-missing.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      expect(raw.galleryFound).toBe(true)
      expect(raw.imageUrls.length).toBeGreaterThan(0)
    } finally {
      await session.close()
    }
  }, 30_000)
})

describe('evaluateMwDetail — fixture-driven (mw-v4: Nitro lazy-load slider)', () => {
  it('finds all vehicle images from the real mainimagetarget/vehimage-N slider markup, not just one', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v4-nitro-lazy-slider.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      expect(raw.galleryFound).toBe(true)
      // mainimagetarget duplicates vehimage-0's URL, so 4 <img> elements yield 3 unique URLs.
      expect(raw.imageUrls).toEqual([
        'https://s3.amazonaws.com/vehicle-images/e2e84737-77e9-42d8-ab0e-f3b0dc09e347.jpg',
        'https://s3.amazonaws.com/vehicle-images/421d0668-faf9-4791-b48a-7cd4fed18b63.jpg',
        'https://s3.amazonaws.com/vehicle-images/00aa8dfb-23a6-4e01-a7c4-9109b2ecd069.jpg',
      ])
      // The promo banner sits inside the same slider container but is not a
      // vehimage-N/mainimagetarget element, so it must not be collected.
      expect(raw.imageUrls.every((u) => !u.includes('inventory-image-banner-blank'))).toBe(true)

      const detail = parseMwDetail(raw)
      expect(detail.images).toHaveLength(3)
    } finally {
      await session.close()
    }
  }, 30_000)
})

describe('evaluateMwDetail — fixture-driven (mw-v3: gallery pollution)', () => {
  it('returns galleryFound: false when no vehicle gallery container is present', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v3-gallery-pollution.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      expect(raw.galleryFound).toBe(false)
      // imageUrls must be empty — not populated from the polluted content-area
      expect(raw.imageUrls).toEqual([])
    } finally {
      await session.close()
    }
  }, 30_000)

  it('parseMwDetail returns empty images when galleryFound is false', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v3-gallery-pollution.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      const detail = parseMwDetail(raw)
      expect(detail.images).toEqual([])
    } finally {
      await session.close()
    }
  }, 30_000)

  it('still extracts description even when gallery is absent', async () => {
    const service = new PlaywrightBrowserService()
    const session = await service.launch()
    try {
      const page = await session.newPage()
      await page.setContent(loadFixture('mw-v3-gallery-pollution.html'), { waitUntil: 'domcontentloaded' })
      const raw = await evaluateMwDetail(page)
      await page.close()

      expect(raw.descriptionFound).toBe(true)
      expect(raw.descriptionText).toContain('VMI Northstar in-floor ramp')
    } finally {
      await session.close()
    }
  }, 30_000)
})
