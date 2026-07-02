import { describe, expect, it } from 'vitest'
import { vehicleDetailPath } from './vehicle-url.js'

describe('vehicleDetailPath', () => {
  it('builds the unprefixed vehicle route', () => {
    expect(vehicleDetailPath('listing-1')).toBe('/vehicle/listing-1')
  })

  it('preserves a locale prefix without a duplicate slash', () => {
    expect(vehicleDetailPath('listing-1', '/es/')).toBe('/es/vehicle/listing-1')
  })

  it('encodes identifiers before adding them to the route', () => {
    expect(vehicleDetailPath('source vehicle/1')).toBe('/vehicle/source%20vehicle%2F1')
  })
})
