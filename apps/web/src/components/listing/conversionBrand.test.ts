import { describe, expect, it } from 'vitest'
import { conversionBrandSlug, matchConversionProduct } from './conversionBrand'

describe('conversionBrandSlug', () => {
  it('normalizes a conversion manufacturer string to the API slug format', () => {
    expect(conversionBrandSlug(' BraunAbility ')).toBe('braunability')
    expect(conversionBrandSlug('Freedom Motors USA')).toBe('freedom-motors-usa')
    expect(conversionBrandSlug('AMS & Vans')).toBe('ams-and-vans')
  })

  it('returns null for empty or missing values', () => {
    expect(conversionBrandSlug(null)).toBeNull()
    expect(conversionBrandSlug(undefined)).toBeNull()
    expect(conversionBrandSlug('   ')).toBeNull()
  })
})

describe('matchConversionProduct', () => {
  const products = [
    {
      id: 'rear',
      name: 'Chrysler Pacifica Foldout Rear-Entry',
      conversionType: 'rear_entry',
      rampType: 'fold_out',
      floorLoweringInches: null,
      msrpCents: null,
    },
    {
      id: 'side',
      name: 'Toyota Sienna Foldout Side-Entry',
      conversionType: 'side_entry',
      rampType: 'fold_out',
      floorLoweringInches: 10,
      msrpCents: null,
    },
  ]

  it('prefers the product that matches model and conversion specs', () => {
    expect(
      matchConversionProduct(products, {
        make: 'Toyota',
        model: 'Sienna',
        conversionType: 'side_entry',
        rampType: 'fold_out',
      }),
    ).toEqual(products[1])
  })

  it('falls back to the first catalog product when no signal matches', () => {
    expect(
      matchConversionProduct(products, {
        make: 'Ford',
        model: 'Transit',
        conversionType: 'unknown',
        rampType: 'unknown',
      }),
    ).toEqual(products[0])
  })
})
