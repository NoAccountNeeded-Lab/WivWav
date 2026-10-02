import { describe, expect, it } from 'vitest'
import { isRecord, pickBoolean, pickNumber, pickString, pickStringRequired } from './safe-pick.js'

describe('safe-pick', () => {
  it('isRecord accepts objects (incl. arrays) and rejects null/primitives', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
    expect(isRecord(undefined)).toBe(false)
  })

  it('pickString returns strings or null', () => {
    expect(pickString('a')).toBe('a')
    expect(pickString(1)).toBeNull()
    expect(pickString(undefined)).toBeNull()
  })

  it('pickStringRequired falls back to the default', () => {
    expect(pickStringRequired('a')).toBe('a')
    expect(pickStringRequired(null)).toBe('')
    expect(pickStringRequired(null, 'n/a')).toBe('n/a')
  })

  it('pickNumber rejects non-finite values', () => {
    expect(pickNumber(3)).toBe(3)
    expect(pickNumber(Number.NaN)).toBe(0)
    expect(pickNumber(Number.POSITIVE_INFINITY, 7)).toBe(7)
    expect(pickNumber('3')).toBe(0)
  })

  it('pickBoolean falls back for non-booleans', () => {
    expect(pickBoolean(true)).toBe(true)
    expect(pickBoolean(false, true)).toBe(false)
    expect(pickBoolean('true')).toBe(false)
    expect(pickBoolean(undefined, true)).toBe(true)
  })
})
