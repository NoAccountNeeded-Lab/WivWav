import { describe, expect, it } from 'vitest'
import { checkDigitValid, isValidVin, normalizeVin } from './vin.js'

describe('vin', () => {
  it('normalizes whitespace, case, and punctuation', () => {
    expect(normalizeVin(' 5tdy-rkec8-rs205440 ')).toBe('5TDYRKEC8RS205440')
  })

  it('accepts a well-formed 17-character VIN', () => {
    expect(isValidVin('5TDYRKEC8RS205440')).toBe(true)
  })

  it('rejects a VIN with a forbidden character', () => {
    expect(isValidVin('5TDYIKEC8RS205440')).toBe(false)
  })

  it('rejects a VIN of the wrong length', () => {
    expect(isValidVin('SHORT')).toBe(false)
  })

  it('validates the North American check digit', () => {
    expect(checkDigitValid('5TDYRKEC8RS205440')).toBe(true)
  })

  it('rejects a VIN with an invalid check digit', () => {
    expect(checkDigitValid('5TDYRKEC8RS205441')).toBe(false)
  })
})
