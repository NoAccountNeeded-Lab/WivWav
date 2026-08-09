import { describe, it, expect } from 'vitest'
import { normalizeVin, isValidVin, checkDigitValid } from './vin.js'

describe('normalizeVin', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeVin('  1FMJK1HT0MEA12345  ')).toBe('1FMJK1HT0MEA12345')
  })

  it('uppercases all characters', () => {
    expect(normalizeVin('1fmjk1ht0mea12345')).toBe('1FMJK1HT0MEA12345')
  })

  it('handles mixed case and whitespace together', () => {
    expect(normalizeVin(' 1fMJk1HT0mEa12345 ')).toBe('1FMJK1HT0MEA12345')
  })

  it('strips non-alphanumeric characters such as hyphens used for display', () => {
    expect(normalizeVin('1FMJ-K1HT0-MEA12345')).toBe('1FMJK1HT0MEA12345')
  })

  it('strips special characters from garbage strings', () => {
    expect(normalizeVin('Voted Lowest Prices!')).toBe('VOTEDLOWESTPRICES')
  })
})

describe('isValidVin', () => {
  it('accepts a well-formed 17-character VIN', () => {
    expect(isValidVin('1FMJK1HT0MEA12345')).toBe(true)
  })

  it('rejects a VIN shorter than 17 characters', () => {
    expect(isValidVin('1FMJK1HT0MEA1234')).toBe(false)
  })

  it('rejects a VIN longer than 17 characters', () => {
    expect(isValidVin('1FMJK1HT0MEA123456')).toBe(false)
  })

  it('rejects a VIN containing I (forbidden character)', () => {
    expect(isValidVin('1FMIK1HT0MEA12345')).toBe(false)
  })

  it('rejects a VIN containing O (forbidden character)', () => {
    expect(isValidVin('1FMOK1HT0MEA12345')).toBe(false)
  })

  it('rejects a VIN containing Q (forbidden character)', () => {
    expect(isValidVin('1FMQK1HT0MEA12345')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidVin('')).toBe(false)
  })

  it('rejects a 16-character string that would be valid otherwise', () => {
    expect(isValidVin('1FMJK1HT0MEA1234')).toBe(false)
  })

  it('accepts VINs with digits in all 17 positions', () => {
    expect(isValidVin('11111111111111111')).toBe(true)
  })
})

describe('checkDigitValid', () => {
  // 5TDYRKEC8RS205440 — Toyota Sienna, check digit at position 8 is '8'
  it('returns true for a VIN with a valid North American check digit', () => {
    expect(checkDigitValid('5TDYRKEC8RS205440')).toBe(true)
  })

  it('returns false when the check digit is wrong', () => {
    // Same VIN with last char changed to '1' — invalid check digit
    expect(checkDigitValid('5TDYRKEC8RS205441')).toBe(false)
  })

  it('returns false for a VIN shorter than 17 characters', () => {
    expect(checkDigitValid('5TDYRKEC8RS20544')).toBe(false)
  })

  it('returns false when a character has no transliteration value (e.g., forbidden I)', () => {
    expect(checkDigitValid('5TDYIKEC8RS205440')).toBe(false)
  })
})
