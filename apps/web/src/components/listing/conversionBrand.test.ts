import { describe, expect, it } from 'vitest'
import { conversionBrandSlug, matchConversionProduct } from './conversionBrand'

// Smoke test only — conversionBrandSlug is implemented and fully tested in
// @wivwav/search (packages/search/src/canonicalize.ts /
// canonicalize.test.ts), which this module re-exports (refs #603). This just
// confirms the re-export is wired up correctly for apps/web callers.
describe('conversionBrandSlug (re-export smoke test)', () => {
  it('normalizes and aliases via the shared @wivwav/search implementation', () => {
    expect(conversionBrandSlug(' BraunAbility ')).toBe('braunability')
    expect(conversionBrandSlug('Rollx')).toBe('rollx-vans')
    expect(conversionBrandSlug(null)).toBeNull()
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
