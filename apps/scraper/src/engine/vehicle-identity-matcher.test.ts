import { describe, it, expect } from 'vitest'
import {
  matchListingPair,
  CANDIDATE_THRESHOLD,
  MATCHER_RULE_ID,
  type MatchableListing,
} from './vehicle-identity-matcher.js'

function makeListing(overrides: Partial<MatchableListing> = {}): MatchableListing {
  return {
    id: 'listing-a',
    sourceId: 'src-1',
    dealerProfileId: 'dealer-1',
    dealerWebsite: 'https://www.example-dealer.com',
    dealerName: 'Example Dealer',
    stockNumber: 'STK123',
    sourceUrl: 'https://www.example-dealer.com/vans/1',
    make: 'Toyota',
    model: 'Sienna',
    year: 2024,
    trim: 'XLE',
    vin: null,
    mileage: 30000,
    priceCents: 5000000,
    zip: '44114',
    city: 'Cleveland',
    state: 'OH',
    ...overrides,
  }
}

describe('matchListingPair — stable-identifier auto-link', () => {
  it('auto-links a no-VIN pair sharing dealer + stock number', () => {
    const a = makeListing({ id: 'a' })
    const b = makeListing({ id: 'b', sourceUrl: 'https://www.example-dealer.com/vans/2' })

    const result = matchListingPair(a, b)

    expect(result.decision).toBe('auto_link')
    expect(result.stableIdentifierMatch).toBe(true)
    expect(result.ruleId).toBe(MATCHER_RULE_ID)
    expect(result.signals.some((s) => s.id === 'stable_dealer_stock_number')).toBe(true)
  })

  it('auto-links a pair with an identical source URL even without a stock number match', () => {
    const a = makeListing({ id: 'a', stockNumber: null, sourceUrl: 'https://www.example-dealer.com/vans/shared' })
    const b = makeListing({ id: 'b', stockNumber: 'OTHER', sourceUrl: 'https://www.example-dealer.com/vans/shared' })

    const result = matchListingPair(a, b)

    expect(result.decision).toBe('auto_link')
    expect(result.signals.some((s) => s.id === 'identical_source_url')).toBe(true)
  })

  it('does NOT auto-link same stock number across different (unconfirmed) dealers', () => {
    const a = makeListing({ id: 'a', dealerProfileId: 'dealer-1', dealerWebsite: 'https://dealer-one.com', dealerName: 'Dealer One' })
    const b = makeListing({
      id: 'b',
      dealerProfileId: 'dealer-2',
      dealerWebsite: 'https://dealer-two.com',
      dealerName: 'Dealer Two',
      sourceUrl: 'https://dealer-two.com/vans/2',
    })

    const result = matchListingPair(a, b)

    expect(result.decision).not.toBe('auto_link')
  })
})

describe('matchListingPair — fuzzy candidate (never auto-links)', () => {
  it('reports a fuzzy match above threshold as candidate, not auto_link', () => {
    const a = makeListing({ id: 'a', stockNumber: 'A1', sourceUrl: 'https://www.example-dealer.com/vans/a' })
    const b = makeListing({
      id: 'b',
      stockNumber: 'B2',
      sourceUrl: 'https://www.example-dealer.com/vans/b',
      mileage: 30500, // within tolerance
      priceCents: 5010000, // within tolerance
    })

    const result = matchListingPair(a, b)

    expect(result.decision).toBe('candidate')
    expect(result.score).toBeGreaterThanOrEqual(CANDIDATE_THRESHOLD)
    expect(result.stableIdentifierMatch).toBe(false)
  })

  it('reports a weak fuzzy match below threshold as no_match', () => {
    const a = makeListing({
      id: 'a',
      dealerProfileId: 'dealer-1',
      stockNumber: 'A1',
      sourceUrl: 'https://www.example-dealer.com/vans/a',
      trim: 'XLE',
      mileage: 30000,
      priceCents: 5000000,
      zip: '44114',
    })
    const b = makeListing({
      id: 'b',
      dealerProfileId: 'dealer-2', // different dealer
      dealerWebsite: 'https://dealer-two.com',
      dealerName: 'Dealer Two',
      stockNumber: 'B2',
      sourceUrl: 'https://dealer-two.com/vans/b',
      trim: null,
      mileage: null,
      priceCents: null,
      zip: '90001', // different location
      city: 'Los Angeles',
      state: 'CA',
    })

    const result = matchListingPair(a, b)

    expect(result.decision).toBe('no_match')
    expect(result.score).toBeLessThan(CANDIDATE_THRESHOLD)
  })

  it('never returns auto_link from fuzzy signals alone, no matter how many positive signals stack', () => {
    // Same dealer, matching trim/mileage/price/zip/image overlap — strong fuzzy
    // signal stack, but with no shared stock number / source URL it must stay a candidate.
    const a = makeListing({
      id: 'a',
      stockNumber: 'A1',
      sourceUrl: 'https://www.example-dealer.com/vans/a',
      trustedImageHashes: ['hash1', 'hash2'],
    })
    const b = makeListing({
      id: 'b',
      stockNumber: 'B2',
      sourceUrl: 'https://www.example-dealer.com/vans/b',
      trustedImageHashes: ['hash1', 'hash2'],
    })

    const result = matchListingPair(a, b)

    expect(result.decision).toBe('candidate')
  })
})

describe('matchListingPair — negative evidence blocks auto-linking', () => {
  it('a conflicting valid VIN blocks linking even when stock number/dealer match', () => {
    const a = makeListing({ id: 'a', vin: '5TDYRKEC8RS205440' })
    const b = makeListing({ id: 'b', vin: '1FTFW1XT0EFA12345', sourceUrl: 'https://www.example-dealer.com/vans/2' })

    const result = matchListingPair(a, b)

    expect(result.decision).toBe('no_match')
    expect(result.signals.some((s) => s.id === 'conflicting_vin')).toBe(true)
  })

  it('an incompatible make/model blocks linking even when other signals match', () => {
    const a = makeListing({ id: 'a', make: 'Toyota', model: 'Sienna' })
    const b = makeListing({
      id: 'b',
      make: 'Honda',
      model: 'Odyssey',
      sourceUrl: 'https://www.example-dealer.com/vans/2',
    })

    const result = matchListingPair(a, b)

    expect(result.decision).toBe('no_match')
    expect(result.signals.some((s) => s.id === 'incompatible_vehicle')).toBe(true)
  })

  it('an incompatible year (delta > 1) blocks linking', () => {
    const a = makeListing({ id: 'a', year: 2024 })
    const b = makeListing({ id: 'b', year: 2020, sourceUrl: 'https://www.example-dealer.com/vans/2' })

    const result = matchListingPair(a, b)

    expect(result.decision).toBe('no_match')
    expect(result.signals.some((s) => s.id === 'incompatible_vehicle')).toBe(true)
  })

  it('an explicit conflicting trusted image flag blocks linking', () => {
    const a = makeListing({ id: 'a' })
    const b = makeListing({
      id: 'b',
      sourceUrl: 'https://www.example-dealer.com/vans/2',
      conflictingImageHash: true,
    })

    const result = matchListingPair(a, b)

    expect(result.decision).toBe('no_match')
    expect(result.signals.some((s) => s.id === 'conflicting_image_hash')).toBe(true)
  })

  it('does not falsely merge near-identical vehicles at one dealer with distinct stock numbers when other signals are weak', () => {
    const a = makeListing({
      id: 'a',
      stockNumber: 'A1',
      sourceUrl: 'https://www.example-dealer.com/vans/a',
      trim: 'XLE',
      mileage: 30000,
      priceCents: 5000000,
      zip: '44114',
    })
    const b = makeListing({
      id: 'b',
      stockNumber: 'A2', // distinct stock number — same dealer, but NOT the stable-identifier rule
      sourceUrl: 'https://www.example-dealer.com/vans/a2',
      trim: 'LE', // different trim
      mileage: 52000, // outside tolerance
      priceCents: 4700000, // outside tolerance
      zip: '44115', // different zip, different city/state pairing avoided below
      city: 'Lakewood',
      state: 'OH',
    })

    const result = matchListingPair(a, b)

    // Same dealer + compatible vehicle is real signal, but conflicting trim/mileage/price
    // must keep this below auto-link, and the AC requires it not be "falsely merged."
    expect(result.decision).not.toBe('auto_link')
  })

  it('legitimate cross-source photo reuse (shared trusted image hashes) is not treated as a conflict signal', () => {
    const a = makeListing({
      id: 'a',
      dealerProfileId: 'dealer-1',
      stockNumber: 'A1',
      sourceUrl: 'https://www.example-dealer.com/vans/a',
      trustedImageHashes: ['hashX', 'hashY'],
    })
    const b = makeListing({
      id: 'b',
      dealerProfileId: 'dealer-2', // different dealer/source re-listing the same vehicle
      dealerWebsite: 'https://dealer-two.com',
      dealerName: 'Dealer Two',
      stockNumber: 'ZZZ',
      sourceUrl: 'https://dealer-two.com/vans/b',
      trustedImageHashes: ['hashX', 'hashY'], // same photos reused across sources — legitimate
    })

    const result = matchListingPair(a, b)

    // Shared images must contribute positive evidence, never a conflict signal,
    // and must never appear as a negative/zero-weight signal.
    expect(result.signals.every((s) => s.id !== 'conflicting_image_hash')).toBe(true)
    const imageSignal = result.signals.find((s) => s.id === 'trusted_image_hash_overlap')
    expect(imageSignal).toBeDefined()
    expect(imageSignal!.weight).toBeGreaterThan(0)
  })
})
