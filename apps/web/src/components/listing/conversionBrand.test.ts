import { describe, expect, it } from 'vitest'
import { conversionBrandSlug, matchConversionProduct } from './conversionBrand'

describe('conversionBrandSlug', () => {
  it('normalizes a conversion manufacturer string to the API slug format', () => {
    expect(conversionBrandSlug(' BraunAbility ')).toBe('braunability')
    expect(conversionBrandSlug('Freedom Motors')).toBe('freedom-motors')
    expect(conversionBrandSlug('AMS Vans')).toBe('ams-vans')
  })

  it('maps known scraper aliases to seeded brand slugs', () => {
    expect(conversionBrandSlug('Rollx')).toBe('rollx-vans')
    expect(conversionBrandSlug('AMS')).toBe('ams-vans')
    expect(conversionBrandSlug('Freedom')).toBe('freedom-motors')
    expect(conversionBrandSlug('Vantage')).toBe('vantage-mobility')
    expect(conversionBrandSlug('Vantage Mobility International')).toBe('vantage-mobility')
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

  it('does not guess a product when no vehicle name signal matches', () => {
    expect(
      matchConversionProduct(products, {
        make: 'Ford',
        model: 'Transit',
        conversionType: 'unknown',
        rampType: 'unknown',
      }),
    ).toBeNull()
  })

  it('does not match solely on conversion specs', () => {
    expect(
      matchConversionProduct(products, {
        make: 'Ford',
        model: 'Transit',
        conversionType: 'side_entry',
        rampType: 'fold_out',
      }),
    ).toBeNull()
  })
})
