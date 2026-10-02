import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({
  normalizeVin: (v: string) => v.replace(/[^a-z0-9]/gi, '').toUpperCase(),
}))

import { decodeVin, isValidVin } from './vin-decoder.js'

function vpic(values: Record<string, string | null>): Response {
  return new Response(
    JSON.stringify({ Results: Object.entries(values).map(([Variable, Value]) => ({ Variable, Value })) }),
  )
}

const FULL = {
  Make: 'TOYOTA',
  Model: 'Sienna',
  'Model Year': '2024',
  Trim: ' XLE ',
  'Body Class': 'Minivan',
}

describe('isValidVin', () => {
  it('accepts 17-char VINs after normalization', () => {
    expect(isValidVin('5tdy-rkec8-rs205440')).toBe(true)
  })

  it('rejects wrong length and forbidden letters I, O, Q', () => {
    expect(isValidVin('5TDYRKEC8RS20544')).toBe(false)
    expect(isValidVin('5TDYRKEC8RS20544I')).toBe(false)
    expect(isValidVin('5TDYRKEC8RS20544O')).toBe(false)
    expect(isValidVin('5TDYRKEC8RS20544Q')).toBe(false)
  })
})

describe('decodeVin', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('decodes a VIN and trims values', async () => {
    const mock = vi.fn(async () => vpic(FULL))
    vi.stubGlobal('fetch', mock)
    expect(await decodeVin('5TDYRKEC8RS205440')).toEqual({
      make: 'TOYOTA',
      model: 'Sienna',
      year: 2024,
      trim: 'XLE',
      bodyType: 'Minivan',
    })
    expect((mock.mock.calls[0] as unknown as [string])[0]).toContain('/decodevin/5TDYRKEC8RS205440?format=json')
  })

  it('treats "Not Applicable" and null as missing optional fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => vpic({ ...FULL, Trim: 'Not Applicable', 'Body Class': null })))
    const result = await decodeVin('5TDYRKEC8RS205440')
    expect(result?.trim).toBeNull()
    expect(result?.bodyType).toBeNull()
  })

  it.each([['Make'], ['Model'], ['Model Year']])('returns null when %s is missing', async (key) => {
    vi.stubGlobal('fetch', vi.fn(async () => vpic({ ...FULL, [key]: null })))
    expect(await decodeVin('5TDYRKEC8RS205440')).toBeNull()
  })

  it('returns null for a non-numeric year', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => vpic({ ...FULL, 'Model Year': 'abc' })))
    expect(await decodeVin('5TDYRKEC8RS205440')).toBeNull()
  })

  it('returns null on network failure or non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    expect(await decodeVin('5TDYRKEC8RS205440')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })))
    expect(await decodeVin('5TDYRKEC8RS205440')).toBeNull()
  })
})
