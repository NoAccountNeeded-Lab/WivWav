import { describe, it, expect } from 'vitest'
import { FreedomMotorsAdapter } from './freedom-motors.js'

// Integration tests — hit the real freedommotors.com via Playwright.
// Run: pnpm --filter @wivwav/scraper test:integration

describe('FreedomMotorsAdapter', () => {
  it('checkStructure returns a consistent hash', async () => {
    const adapter = new FreedomMotorsAdapter(null, { maxPages: 1 })
    const result = await adapter.checkStructure()

    expect(result.changed).toBe(false)
    expect(result.currentHash).toBeTruthy()
    expect(result.currentHash).toHaveLength(64)
    expect(result.previousHash).toBeNull()
  }, 30_000)

  it('scrapes at least 8 listings from page 1', async () => {
    const adapter = new FreedomMotorsAdapter(null, { maxPages: 1 })
    const result = await adapter.scrape()

    expect(result.listings.length).toBeGreaterThan(8)
    expect(result.fingerprintHash).toBeTruthy()
  }, 60_000)

  it('each listing has required vehicle fields', async () => {
    const adapter = new FreedomMotorsAdapter(null, { maxPages: 1 })
    const { listings } = await adapter.scrape()

    for (const listing of listings.slice(0, 5)) {
      expect(listing.sourceId).toBe('freedom-motors')
      expect(listing.sourceUrl).toContain('freedommotors.com/product/')
      expect(listing.make).toBeTruthy()
      expect(listing.model).toBeTruthy()
      expect(listing.year).toBeGreaterThan(2000)
      expect(['new', 'used', 'certified_pre_owned']).toContain(listing.condition)
      expect(listing.dealer.name).toBe('Freedom Motors')
      expect(listing.location.state).toBe('MI')
    }
  }, 60_000)

  it('listings have WAV fields, price, and images', async () => {
    const adapter = new FreedomMotorsAdapter(null, { maxPages: 1 })
    const { listings } = await adapter.scrape()

    const withPrice = listings.filter(l => l.priceCents !== null)
    expect(withPrice.length).toBeGreaterThan(listings.length / 2)

    for (const listing of listings.slice(0, 5)) {
      expect(['rear_entry', 'side_entry', 'unknown']).toContain(listing.wav.conversionType)
      expect(listing.images.length).toBeGreaterThan(0)
    }
  }, 60_000)

  it('paginates across multiple pages returning more unique listings', async () => {
    const adapter = new FreedomMotorsAdapter(null, { maxPages: 2 })
    const { listings } = await adapter.scrape()

    expect(listings.length).toBeGreaterThan(8)

    const vins = listings.map(l => l.vin).filter((v): v is string => v !== null)
    expect(new Set(vins).size).toBe(vins.length)
  }, 120_000)
})
