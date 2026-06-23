import { describe, expect, it, vi } from 'vitest'
import {
  createRateLimitedFetcher,
  deriveBlvdDealerProfileUrl,
  enrichBlvdDealerListing,
  extractDealerWebsiteFromProfileHtml,
  extractVinSpecificUrlFromDealerHtml,
} from './blvd-dealer-enrichment.js'

const SOURCE_URL = 'https://www.blvd.com/wheelchair-vans/united-access-sacramento-ca/5TDYRKEC8RS205440'
const PROFILE_URL = 'https://www.blvd.com/wheelchair-van-dealers/united-access-sacramento-ca'
const DEALER_WEBSITE = 'https://www.braunability.com/unitedaccess/us/en/locations/sacramento-ca.html'
const VIN = '5TDYRKEC8RS205440'

describe('deriveBlvdDealerProfileUrl', () => {
  it('derives the dealer profile URL from a BLVD wheelchair van source URL', () => {
    expect(deriveBlvdDealerProfileUrl(SOURCE_URL)).toBe(PROFILE_URL)
  })

  it('derives the dealer profile URL from a BLVD wheelchair truck source URL', () => {
    expect(deriveBlvdDealerProfileUrl(
      'https://www.blvd.com/wheelchair-trucks/united-access-sacramento-ca/5TDYRKEC8RS205440',
    )).toBe(PROFILE_URL)
  })

  it('returns null for non-BLVD URLs and unsupported BLVD paths', () => {
    expect(deriveBlvdDealerProfileUrl('https://dealer.example.com/listing/123')).toBeNull()
    expect(deriveBlvdDealerProfileUrl('https://www.blvd.com/wheelchair-vans-for-sale')).toBeNull()
  })
})

describe('extractDealerWebsiteFromProfileHtml', () => {
  it('extracts the Visit Dealer Website link from a BLVD dealer profile page', () => {
    const html = `
      <main>
        <a href="/contact">Contact Dealer</a>
        <a href="${DEALER_WEBSITE}">Visit Dealer's Website</a>
      </main>
    `

    expect(extractDealerWebsiteFromProfileHtml(html, PROFILE_URL)).toBe(DEALER_WEBSITE)
  })

  it('returns null when the dealer profile does not include the website link', () => {
    expect(extractDealerWebsiteFromProfileHtml('<a href="/contact">Contact Dealer</a>', PROFILE_URL)).toBeNull()
  })
})

describe('extractVinSpecificUrlFromDealerHtml', () => {
  it('extracts a dealer-hosted direct vehicle URL when an anchor references the VIN', () => {
    const directUrl = 'https://www.braunability.com/inventory/5TDYRKEC8RS205440.html'
    const html = `<a href="${directUrl}">2024 Toyota Sienna ${VIN}</a>`

    expect(extractVinSpecificUrlFromDealerHtml(html, DEALER_WEBSITE, VIN)).toBe(directUrl)
  })

  it('returns null when the VIN is absent from dealer-hosted links', () => {
    const html = '<a href="/inventory/123">2024 Toyota Sienna</a>'

    expect(extractVinSpecificUrlFromDealerHtml(html, DEALER_WEBSITE, VIN)).toBeNull()
  })
})

describe('enrichBlvdDealerListing', () => {
  it('fetches the profile and one dealer page to return dealer website and direct URL', async () => {
    const directUrl = 'https://www.braunability.com/inventory/5TDYRKEC8RS205440.html'
    const fetchPage = vi.fn(async (url: string) => {
      if (url === PROFILE_URL) {
        return `<a href="${DEALER_WEBSITE}">Visit Dealer's Website</a>`
      }
      if (url === DEALER_WEBSITE) {
        return `<a href="${directUrl}">${VIN}</a>`
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    await expect(enrichBlvdDealerListing({
      sourceUrl: SOURCE_URL,
      vin: VIN,
      fetchPage,
    })).resolves.toEqual({
      dealerWebsite: DEALER_WEBSITE,
      directVehicleUrl: directUrl,
    })
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('persists dealer website but keeps buyer URL fallback when direct VIN matching fails', async () => {
    const log = vi.fn()
    const fetchPage = vi.fn(async (url: string) => {
      if (url === PROFILE_URL) {
        return `<a href="${DEALER_WEBSITE}">Visit Dealer's Website</a>`
      }
      if (url === DEALER_WEBSITE) {
        return '<a href="/inventory/other">Another van</a>'
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    await expect(enrichBlvdDealerListing({
      sourceUrl: SOURCE_URL,
      vin: VIN,
      fetchPage,
      log,
    })).resolves.toEqual({
      dealerWebsite: DEALER_WEBSITE,
      directVehicleUrl: null,
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('No high-confidence VIN page found'))
  })

  it('logs and returns empty enrichment when profile lookup fails', async () => {
    const log = vi.fn()
    const fetchPage = vi.fn(async () => {
      throw new Error('timeout')
    })

    await expect(enrichBlvdDealerListing({
      sourceUrl: SOURCE_URL,
      vin: VIN,
      fetchPage,
      log,
    })).resolves.toEqual({
      dealerWebsite: null,
      directVehicleUrl: null,
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Dealer profile lookup failed'))
  })
})

describe('createRateLimitedFetcher', () => {
  it('spaces repeated network calls by the configured interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-02T00:00:00Z'))

    try {
      const fetchPage = vi.fn(async (url: string) => url)
      const limitedFetch = createRateLimitedFetcher(fetchPage, 1_000)

      await expect(limitedFetch('https://dealer.example.com/profile')).resolves.toBe('https://dealer.example.com/profile')

      const secondFetch = limitedFetch('https://dealer.example.com/inventory')

      // The second fetch is delayed by jitteredSleep. The actual delay is the
      // remaining interval (1000ms) adjusted by ±20% jitter, so anywhere
      // between 800ms and 1200ms. Advance past the maximum jitter window to
      // guarantee the timer has fired.
      expect(fetchPage).toHaveBeenCalledTimes(1) // no immediate second call
      await vi.advanceTimersByTimeAsync(1_200)
      await expect(secondFetch).resolves.toBe('https://dealer.example.com/inventory')
      expect(fetchPage).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
