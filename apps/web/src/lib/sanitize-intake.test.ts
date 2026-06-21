import { describe, it, expect } from 'vitest'
import { sanitizeIntakeFilters } from './sanitize-intake'

describe('sanitizeIntakeFilters', () => {
  it('returns empty object for null input', () => {
    expect(sanitizeIntakeFilters(null)).toEqual({})
  })

  it('returns empty object for non-object input', () => {
    expect(sanitizeIntakeFilters('string')).toEqual({})
    expect(sanitizeIntakeFilters(42)).toEqual({})
    expect(sanitizeIntakeFilters(undefined)).toEqual({})
  })

  it('returns empty object for empty object', () => {
    expect(sanitizeIntakeFilters({})).toEqual({})
  })

  it('returns empty object when all fields are null', () => {
    expect(sanitizeIntakeFilters({
      conversionType: null,
      rampType: null,
      wavFeatures: null,
      condition: null,
      priceMax: null,
      state: null,
    })).toEqual({})
  })

  describe('conversionType', () => {
    it('accepts rear_entry', () => {
      expect(sanitizeIntakeFilters({ conversionType: 'rear_entry' })).toEqual({
        conversionType: 'rear_entry',
      })
    })

    it('accepts side_entry', () => {
      expect(sanitizeIntakeFilters({ conversionType: 'side_entry' })).toEqual({
        conversionType: 'side_entry',
      })
    })

    it('rejects unknown conversionType values', () => {
      expect(sanitizeIntakeFilters({ conversionType: 'top_entry' })).toEqual({})
      expect(sanitizeIntakeFilters({ conversionType: 'unknown' })).toEqual({})
      expect(sanitizeIntakeFilters({ conversionType: '' })).toEqual({})
    })
  })

  describe('rampType', () => {
    it('accepts in_floor', () => {
      expect(sanitizeIntakeFilters({ rampType: 'in_floor' })).toEqual({ rampType: 'in_floor' })
    })

    it('accepts fold_out', () => {
      expect(sanitizeIntakeFilters({ rampType: 'fold_out' })).toEqual({ rampType: 'fold_out' })
    })

    it('accepts fold_in', () => {
      expect(sanitizeIntakeFilters({ rampType: 'fold_in' })).toEqual({ rampType: 'fold_in' })
    })

    it('rejects unknown rampType values', () => {
      expect(sanitizeIntakeFilters({ rampType: 'none' })).toEqual({})
      expect(sanitizeIntakeFilters({ rampType: 'unknown' })).toEqual({})
    })
  })

  describe('wavFeatures', () => {
    it('accepts known wav feature values', () => {
      expect(sanitizeIntakeFilters({ wavFeatures: ['has_lift'] })).toEqual({ wavFeatures: ['has_lift'] })
      expect(sanitizeIntakeFilters({ wavFeatures: ['hand_controls'] })).toEqual({ wavFeatures: ['hand_controls'] })
      expect(sanitizeIntakeFilters({ wavFeatures: ['has_lift', 'transfer_seat'] })).toEqual({
        wavFeatures: ['has_lift', 'transfer_seat'],
      })
    })

    it('drops unknown wav feature values', () => {
      expect(sanitizeIntakeFilters({ wavFeatures: ['has_lift', 'unknown_feature'] })).toEqual({
        wavFeatures: ['has_lift'],
      })
      expect(sanitizeIntakeFilters({ wavFeatures: ['unknown_feature'] })).toEqual({})
    })

    it('omits wavFeatures when not an array', () => {
      expect(sanitizeIntakeFilters({ wavFeatures: 'has_lift' })).toEqual({})
      expect(sanitizeIntakeFilters({ wavFeatures: null })).toEqual({})
    })

    it('omits wavFeatures when array is empty', () => {
      expect(sanitizeIntakeFilters({ wavFeatures: [] })).toEqual({})
    })
  })

  describe('condition', () => {
    it('accepts new', () => {
      expect(sanitizeIntakeFilters({ condition: 'new' })).toEqual({ condition: 'new' })
    })

    it('accepts used', () => {
      expect(sanitizeIntakeFilters({ condition: 'used' })).toEqual({ condition: 'used' })
    })

    it('accepts certified_pre_owned', () => {
      expect(sanitizeIntakeFilters({ condition: 'certified_pre_owned' })).toEqual({
        condition: 'certified_pre_owned',
      })
    })

    it('rejects unknown condition values', () => {
      expect(sanitizeIntakeFilters({ condition: 'CPO' })).toEqual({})
      expect(sanitizeIntakeFilters({ condition: 'refurbished' })).toEqual({})
    })
  })

  describe('priceMax', () => {
    it('accepts positive integer', () => {
      expect(sanitizeIntakeFilters({ priceMax: 40000 })).toEqual({ priceMax: 40000 })
    })

    it('rounds floating-point values', () => {
      expect(sanitizeIntakeFilters({ priceMax: 39999.99 })).toEqual({ priceMax: 40000 })
    })

    it('rejects zero', () => {
      expect(sanitizeIntakeFilters({ priceMax: 0 })).toEqual({})
    })

    it('rejects negative values', () => {
      expect(sanitizeIntakeFilters({ priceMax: -1000 })).toEqual({})
    })

    it('rejects non-finite values', () => {
      expect(sanitizeIntakeFilters({ priceMax: Infinity })).toEqual({})
      expect(sanitizeIntakeFilters({ priceMax: NaN })).toEqual({})
    })

    it('rejects string values', () => {
      expect(sanitizeIntakeFilters({ priceMax: '40000' })).toEqual({})
    })

    it('accepts priceMax at the upper boundary (500000)', () => {
      expect(sanitizeIntakeFilters({ priceMax: 500_000 })).toEqual({ priceMax: 500_000 })
    })

    it('rejects priceMax above the upper boundary (500001)', () => {
      expect(sanitizeIntakeFilters({ priceMax: 500_001 })).toEqual({})
    })
  })

  describe('state', () => {
    it('accepts valid two-letter state codes', () => {
      expect(sanitizeIntakeFilters({ state: 'TX' })).toEqual({ state: 'TX' })
      expect(sanitizeIntakeFilters({ state: 'CA' })).toEqual({ state: 'CA' })
      expect(sanitizeIntakeFilters({ state: 'DC' })).toEqual({ state: 'DC' })
    })

    it('normalizes lowercase to uppercase', () => {
      expect(sanitizeIntakeFilters({ state: 'tx' })).toEqual({ state: 'TX' })
      expect(sanitizeIntakeFilters({ state: 'fl' })).toEqual({ state: 'FL' })
    })

    it('rejects invalid state codes', () => {
      expect(sanitizeIntakeFilters({ state: 'ZZ' })).toEqual({})
      expect(sanitizeIntakeFilters({ state: 'Texas' })).toEqual({})
      expect(sanitizeIntakeFilters({ state: '' })).toEqual({})
    })

    it('rejects non-string state', () => {
      expect(sanitizeIntakeFilters({ state: 42 })).toEqual({})
    })
  })

  it('combines multiple valid fields', () => {
    expect(
      sanitizeIntakeFilters({
        conversionType: 'rear_entry',
        rampType: 'in_floor',
        wavFeatures: ['hand_controls'],
        condition: 'used',
        priceMax: 35000,
        state: 'FL',
      }),
    ).toEqual({
      conversionType: 'rear_entry',
      rampType: 'in_floor',
      wavFeatures: ['hand_controls'],
      condition: 'used',
      priceMax: 35000,
      state: 'FL',
    })
  })

  it('silently drops extra unknown keys', () => {
    expect(
      sanitizeIntakeFilters({
        conversionType: 'rear_entry',
        injectedField: 'DROP_ME',
        __proto__: 'malicious',
      }),
    ).toEqual({ conversionType: 'rear_entry' })
  })
})
