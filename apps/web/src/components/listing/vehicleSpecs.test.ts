import { describe, expect, it } from 'vitest'
import { deriveListingSpecs } from './vehicleSpecs.js'

const listing = {
  engine: '3.5L V6',
  transmission: 'Automatic',
  fuelType: 'Gasoline',
  color: 'Silver',
  condition: 'certified_pre_owned',
  vin: '1FMJK1HT0MEA12345',
  stockNumber: 'WAV-42',
}

describe('deriveListingSpecs', () => {
  it('includes populated listing and model fields', () => {
    expect(deriveListingSpecs(listing, 'Minivan', new Set())).toEqual([
      { label: 'Body type', value: 'Minivan' },
      { label: 'Engine', value: '3.5L V6' },
      { label: 'Transmission', value: 'Automatic' },
      { label: 'Fuel type', value: 'Gasoline' },
      { label: 'Exterior color', value: 'Silver' },
      { label: 'Condition', value: 'certified pre owned' },
      { label: 'VIN', value: '1FMJK1HT0MEA12345', mono: true },
      { label: 'Seller stock number', value: 'WAV-42', mono: true },
    ])
  })

  it('suppresses listing values already covered by cited model research', () => {
    const result = deriveListingSpecs(
      listing,
      null,
      new Set(['engineDescription', 'transmission', 'fuelType']),
    )

    expect(result.map((spec) => spec.label)).not.toContain('Engine')
    expect(result.map((spec) => spec.label)).not.toContain('Transmission')
    expect(result.map((spec) => spec.label)).not.toContain('Fuel type')
  })

  it('does not create rows for missing optional fields', () => {
    const result = deriveListingSpecs(
      {
        engine: null,
        transmission: null,
        fuelType: null,
        color: null,
        condition: 'used',
        vin: null,
        stockNumber: null,
      },
      null,
      new Set(),
    )

    expect(result).toEqual([{ label: 'Condition', value: 'used' }])
  })
})
