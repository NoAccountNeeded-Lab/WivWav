import { describe, expect, it } from 'vitest'
import { canonicalTransmission, cityStateKey, validWheelchairCapacity } from './shopping-filters.js'

describe('shopping filter normalization', () => {
  it.each(['Automatic', '6-Speed Automatic', 'A/T', '6A'])('normalizes %s', (raw) => {
    expect(canonicalTransmission(raw)).toBe('automatic')
  })
  it.each([['5-speed manual', 'manual'], ['CVT', 'cvt'], ['Dual-Clutch', 'automated_manual'], [null, null], ['unknown', null]] as const)('normalizes %s', (raw, expected) => {
    expect(canonicalTransmission(raw)).toBe(expected)
  })
  it('keeps same-named cities distinct by state', () => {
    expect([cityStateKey(' Springfield ', 'il'), cityStateKey('Springfield', 'MO')]).toEqual(['springfield|IL', 'springfield|MO'])
  })
  it.each([[null, 'IL'], ['Springfield', null], ['City|IL', 'MO'], ['City', 'Illinois'], ['', 'CA']] as const)('omits incomplete or ambiguous city pairs', (city, state) => {
    expect(cityStateKey(city, state)).toBeNull()
  })
  it.each([null, undefined, 0, -1, 1.5, 7, NaN, Infinity])('does not index invalid capacity %s as zero', (value) => {
    expect(validWheelchairCapacity(value)).toBeNull()
  })
  it.each([1, 6])('indexes exact capacity %s', (value) => {
    expect(validWheelchairCapacity(value)).toBe(value)
  })
})
