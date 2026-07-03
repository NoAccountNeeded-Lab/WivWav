import { describe, expect, it } from 'vitest'
import { buildSearchHref, countActiveResultFilters } from './results-url'

describe('buildSearchHref', () => {
  it('should preserve every filter and sort value in a bookmarkable results URL', () => {
    const params = new URLSearchParams({
      make: 'Toyota,Honda',
      priceMax: '4500000',
      wavFeatures: 'power_ramp,hand_controls',
      sort: 'priceCents:asc',
    })

    expect(buildSearchHref('/en/results', params)).toBe(
      '/en/results?make=Toyota%2CHonda&priceMax=4500000&wavFeatures=power_ramp%2Chand_controls&sort=priceCents%3Aasc',
    )
  })

  it('should update sort and reset pagination without changing the results pathname', () => {
    const params = new URLSearchParams({
      make: 'Toyota',
      page: '4',
      sort: 'listedAt:desc',
    })

    expect(
      buildSearchHref(
        '/es/results',
        params,
        { sort: 'mileage:asc' },
        true,
      ),
    ).toBe('/es/results?make=Toyota&sort=mileage%3Aasc')
  })

  it('should return the pathname without a trailing question mark when filters are empty', () => {
    expect(buildSearchHref('/results', new URLSearchParams())).toBe('/results')
  })
})

describe('countActiveResultFilters', () => {
  it('should ignore sort and pagination when describing personalized filters', () => {
    const params = new URLSearchParams({
      state: 'CO',
      rampType: 'fold_out',
      sort: 'priceCents:asc',
      page: '2',
    })

    expect(countActiveResultFilters(params)).toBe(2)
  })

  it('should count an active sellerType filter', () => {
    const params = new URLSearchParams({
      sellerType: 'dealer',
    })

    expect(countActiveResultFilters(params)).toBe(1)
  })
})
