import { describe, expect, it } from 'vitest'
import { buildSearchHref, countActiveResultFilters } from './results-url'
import { removeFilterValue, shoppingFilterLabel } from './shopping-filter-url'

describe('shopping filter URLs', () => {
  it('round trips composite cities and every shopping filter with old constraints and locale', () => {
    const params = new URLSearchParams({ make: 'Ford,Toyota', trim: 'LE', state: 'IL', city: 'springfield|MO,portland|OR', transmission: 'automatic,cvt', wheelchairCapacity: '1,6', conversionStatus: 'unknown,complete', page: '3', sort: 'year:desc' })
    const href = buildSearchHref('/es/results', params)
    expect(new URL(href, 'https://example.test').searchParams.toString()).toBe(params.toString())
    expect(countActiveResultFilters(params)).toBe(7)
  })
  it('keeps an explicitly conflicting city visible until individually removed', () => {
    const params = new URLSearchParams({ state: 'IL', city: 'springfield|MO,portland|OR', wheelchairCapacity: '2', page: '3' })
    const next = removeFilterValue(params, 'city', 'springfield|MO')
    expect(Object.fromEntries(next)).toEqual({ state: 'IL', city: 'portland|OR', wheelchairCapacity: '2' })
    expect(shoppingFilterLabel('city', 'springfield|MO')).toBe('Springfield, MO')
  })
  it('removes the last exact capacity without modifying old filters', () => {
    expect(removeFilterValue(new URLSearchParams('make=Ford&wheelchairCapacity=1'), 'wheelchairCapacity', '1').toString()).toBe('make=Ford')
  })
})
