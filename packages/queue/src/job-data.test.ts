import { describe, it, expect } from 'vitest'
import { getStringField, getBooleanField } from './job-data.js'

describe('getStringField', () => {
  it('returns the string value when present', () => {
    expect(getStringField({ sourceId: 'abc' }, 'sourceId')).toBe('abc')
  })

  it('returns undefined for a non-string value', () => {
    expect(getStringField({ sourceId: 123 }, 'sourceId')).toBeUndefined()
  })

  it('returns undefined when the key is missing', () => {
    expect(getStringField({}, 'sourceId')).toBeUndefined()
  })

  it('returns undefined for non-object data', () => {
    expect(getStringField(null, 'sourceId')).toBeUndefined()
    expect(getStringField('abc', 'sourceId')).toBeUndefined()
    expect(getStringField(undefined, 'sourceId')).toBeUndefined()
  })
})

describe('getBooleanField', () => {
  it('returns the boolean value when present', () => {
    expect(getBooleanField({ requiresBrowser: true }, 'requiresBrowser')).toBe(true)
    expect(getBooleanField({ requiresBrowser: false }, 'requiresBrowser')).toBe(false)
  })

  it('returns undefined for a non-boolean value', () => {
    expect(getBooleanField({ requiresBrowser: 'true' }, 'requiresBrowser')).toBeUndefined()
  })

  it('returns undefined when the key is missing', () => {
    expect(getBooleanField({}, 'requiresBrowser')).toBeUndefined()
  })

  it('returns undefined for non-object data', () => {
    expect(getBooleanField(null, 'requiresBrowser')).toBeUndefined()
    expect(getBooleanField(undefined, 'requiresBrowser')).toBeUndefined()
  })
})
