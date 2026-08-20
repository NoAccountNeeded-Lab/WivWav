import { describe, it, expect } from 'vitest'
import { applyFieldTransform } from './field-transforms.js'

describe('applyFieldTransform', () => {
  describe('trimText', () => {
    it('collapses internal whitespace and trims', () => {
      expect(applyFieldTransform('trimText', '  Ebony   Black \n')).toBe('Ebony Black')
    })

    it('returns null for whitespace-only input', () => {
      expect(applyFieldTransform('trimText', '   ')).toBeNull()
    })
  })

  describe('parsePrice', () => {
    it('parses a dollar amount into integer cents', () => {
      expect(applyFieldTransform('parsePrice', '$70,000')).toBe(7_000_000)
    })

    it('parses a decimal dollar amount into integer cents', () => {
      expect(applyFieldTransform('parsePrice', '70000.50')).toBe(7_000_050)
    })

    it('returns null when no digits are present', () => {
      expect(applyFieldTransform('parsePrice', 'Call for price')).toBeNull()
    })
  })

  describe('parseInches', () => {
    it('parses a bare integer', () => {
      expect(applyFieldTransform('parseInches', '33')).toBe(33)
    })

    it('parses an integer with a trailing unit', () => {
      expect(applyFieldTransform('parseInches', '33 in.')).toBe(33)
      expect(applyFieldTransform('parseInches', '33" wide')).toBe(33)
    })

    it('returns null when no number is present', () => {
      expect(applyFieldTransform('parseInches', 'N/A')).toBeNull()
    })
  })

  describe('afterColon', () => {
    it('strips a leading label and colon, trimming the remainder', () => {
      expect(applyFieldTransform('afterColon', 'Exterior Color: Redline 2 Coat Pearl')).toBe('Redline 2 Coat Pearl')
    })

    it('splits on the first colon only, preserving a colon in the value', () => {
      expect(applyFieldTransform('afterColon', 'Vehicle Status: Available: Featured')).toBe('Available: Featured')
    })

    it('returns the trimmed input unchanged when no colon is present', () => {
      expect(applyFieldTransform('afterColon', '  Gas  ')).toBe('Gas')
    })

    it('returns null when nothing follows the colon', () => {
      expect(applyFieldTransform('afterColon', 'Fuel Type:')).toBeNull()
    })
  })

  describe('unknown/null transform', () => {
    it('falls back to trimText for a null transform', () => {
      expect(applyFieldTransform(null, '  Gasoline Fuel  ')).toBe('Gasoline Fuel')
    })

    it('falls back to trimText for an unrecognized transform name (forward compatibility)', () => {
      expect(applyFieldTransform('someFutureTransform', '  Gasoline Fuel  ')).toBe('Gasoline Fuel')
    })
  })

  describe('idempotence', () => {
    it('produces the same result when applied twice', () => {
      const once = applyFieldTransform('trimText', '  Ebony Black  ')
      const twice = applyFieldTransform('trimText', String(once))
      expect(twice).toBe(once)
    })
  })
})
