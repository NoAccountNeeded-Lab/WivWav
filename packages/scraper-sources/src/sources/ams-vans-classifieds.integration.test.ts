import { describe, it, expect } from 'vitest'
import { AmsVansClassifiedsAdapter } from './ams-vans-classifieds.js'

// Integration tests — hit the real amsvans.com via plain fetch (no browser).
// Run: pnpm --filter @wivwav/scraper-sources test:integration

describe('AmsVansClassifiedsAdapter', () => {
  it('checkStructure returns a consistent hash against the live site', async () => {
    const adapter = new AmsVansClassifiedsAdapter(null)
    const result = await adapter.checkStructure()

    expect(result.currentHash).toBeTruthy()
    expect(result.currentHash).toHaveLength(64)
    expect(result.previousHash).toBeNull()
  }, 30_000)

  it('discovers classified ads from the live sitemap and scrapes a bounded sample', async () => {
    const adapter = new AmsVansClassifiedsAdapter(null, { maxListings: 5, detailFetchDelayMs: 250 })
    const result = await adapter.scrape()

    expect(result.listings.length).toBeGreaterThan(0)
    expect(result.listings.length).toBeLessThanOrEqual(5)
    expect(result.fingerprintHash).toBeTruthy()
  }, 60_000)

  it('each scraped listing has required vehicle fields and no PII', async () => {
    const adapter = new AmsVansClassifiedsAdapter(null, { maxListings: 5, detailFetchDelayMs: 250 })
    const { listings } = await adapter.scrape()

    for (const listing of listings) {
      expect(listing.sourceId).toBe('ams-vans-classifieds')
      expect(listing.sourceUrl).toContain('amsvans.com/wheelchair-vans/cl/')
      expect(listing.make).toBeTruthy()
      expect(listing.model).toBeTruthy()
      expect(listing.year).toBeGreaterThan(1990)
      expect(listing.sellerType).toBe('private')
      expect(listing.dealer).toEqual({ name: null, phone: null, website: null })
      expect(JSON.stringify(listing)).not.toContain('@')
    }
  }, 60_000)
})
