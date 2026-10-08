import { describe, expect, it } from 'vitest'
import { pHashHexToInt, pHashIntToHex } from './phash-int.js'

describe('pHashHexToInt', () => {
  it('maps the zero hash to zero', () => {
    expect(pHashHexToInt('0000000000000000')).toBe(BigInt(0))
  })

  it('maps small hashes to the same positive value', () => {
    expect(pHashHexToInt('0000000000000001')).toBe(BigInt(1))
    expect(pHashHexToInt('7fffffffffffffff')).toBe(BigInt('9223372036854775807'))
  })

  it('reinterprets high-bit hashes as negative (two\'s complement)', () => {
    expect(pHashHexToInt('8000000000000000')).toBe(BigInt('-9223372036854775808'))
    expect(pHashHexToInt('ffffffffffffffff')).toBe(BigInt(-1))
    expect(pHashHexToInt('fffffffffffffffe')).toBe(BigInt(-2))
  })

  it('accepts uppercase hex', () => {
    expect(pHashHexToInt('FFFFFFFFFFFFFFFF')).toBe(BigInt(-1))
  })

  it('rejects non-16-char or non-hex input', () => {
    expect(() => pHashHexToInt('abc')).toThrow()
    expect(() => pHashHexToInt('')).toThrow()
    expect(() => pHashHexToInt('000000000000000g')).toThrow()
    expect(() => pHashHexToInt('00000000000000000')).toThrow()
  })
})

describe('pHashIntToHex', () => {
  it('round-trips through the signed reinterpretation', () => {
    const hashes = [
      '0000000000000000',
      '0000000000000001',
      '7fffffffffffffff',
      '8000000000000000',
      'ffffffffffffffff',
      'abcdef0123456789',
    ]
    for (const hex of hashes) {
      expect(pHashIntToHex(pHashHexToInt(hex))).toBe(hex)
    }
  })

  it('renders negative values as high-bit hex', () => {
    expect(pHashIntToHex(BigInt(-1))).toBe('ffffffffffffffff')
  })

  it('rejects values outside signed int64', () => {
    expect(() => pHashIntToHex(BigInt('9223372036854775808'))).toThrow()
    expect(() => pHashIntToHex(BigInt('-9223372036854775809'))).toThrow()
  })
})
