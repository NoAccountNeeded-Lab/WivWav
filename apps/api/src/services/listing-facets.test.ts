import { describe, it, expect, vi } from 'vitest'
import { ListingFacetsService } from './listing-facets.js'
import { priceBucket, mileageBucket } from './listing-search.js'
import type { CacheService } from './cache/index.js'
import type { SearchService } from './search/index.js'

describe('priceBucket', () => {
  it('returns null for null price', () => {
    expect(priceBucket(null)).toBeNull()
  })

  it('puts 0 cents in the 0-5000 bucket', () => {
    expect(priceBucket(0)).toBe('0-5000')
  })

  it('puts $4 999.99 in the 0-5000 bucket', () => {
    expect(priceBucket(499999)).toBe('0-5000')
  })

  it('puts exactly $5 000 in the 5000-10000 bucket', () => {
    expect(priceBucket(500000)).toBe('5000-10000')
  })

  it('puts $27 500 in the 25000-30000 bucket', () => {
    expect(priceBucket(2750000)).toBe('25000-30000')
  })

  it('respects a custom bucket size', () => {
    expect(priceBucket(1000000, 10000)).toBe('10000-20000')
  })
})

describe('mileageBucket', () => {
  it('returns null for null mileage', () => {
    expect(mileageBucket(null)).toBeNull()
  })

  it('puts 0 miles in the 0-25000 bucket', () => {
    expect(mileageBucket(0)).toBe('0-25000')
  })

  it('puts 24 999 miles in the 0-25000 bucket', () => {
    expect(mileageBucket(24999)).toBe('0-25000')
  })

  it('puts exactly 25 000 miles in the 25000-50000 bucket', () => {
    expect(mileageBucket(25000)).toBe('25000-50000')
  })

  it('puts 87 000 miles in the 75000-100000 bucket', () => {
    expect(mileageBucket(87000)).toBe('75000-100000')
  })
})

describe('ListingFacetsService', () => {
  it('returns ramp type breakdown from facet distribution', async () => {
    const search = {
      search: vi.fn(async () => ({
        hits: [],
        total: 3,
        facetDistribution: {
          rampType: { in_floor: 2, fold_out: 1 },
          wavFeatures: { has_lift: 2, hand_controls: 1 },
          sellerType: { dealer: 2, private: 1 },
        },
      })),
    } as unknown as SearchService
    const cache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
      ping: vi.fn(async () => {}),
      getOrSet: vi.fn(),
    } as unknown as CacheService

    const result = await new ListingFacetsService(search, cache).getFacets({})

    expect(cache.get).toHaveBeenCalledWith('facets:eligible-v1:{}')
    expect(search.search).toHaveBeenCalledWith('listings', expect.objectContaining({
      facets: expect.arrayContaining(['rampType', 'wavFeatures', 'sellerType']),
      limit: 0,
    }))
    expect(result.rampTypeBreakdown).toEqual([
      { value: 'in_floor', count: 2 },
      { value: 'fold_out', count: 1 },
    ])
    expect(result.wavFeatureCounts).toEqual({ has_lift: 2, hand_controls: 1 })
  })

  it('returns sellerType breakdown from facet distribution', async () => {
    const search = {
      search: vi.fn(async () => ({
        hits: [],
        total: 3,
        facetDistribution: {
          sellerType: { dealer: 5, private: 2 },
        },
      })),
    } as unknown as SearchService
    const cache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
      ping: vi.fn(async () => {}),
      getOrSet: vi.fn(),
    } as unknown as CacheService

    const result = await new ListingFacetsService(search, cache).getFacets({})

    expect(result.sellerTypeBreakdown).toEqual([
      { value: 'dealer', count: 5 },
      { value: 'private', count: 2 },
    ])
  })
})
