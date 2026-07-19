import { describe, it, expect } from 'vitest'
import { parseNhtsaYMD, parseNhtsaDMY } from './nhtsa-date-utils.js'

describe('parseNhtsaYMD', () => {
  it('parses a YYYYMMDD integer', () => {
    expect(parseNhtsaYMD(20240115)).toEqual(new Date(2024, 0, 15))
  })

  it('parses a YYYYMMDD string', () => {
    expect(parseNhtsaYMD('20240115')).toEqual(new Date(2024, 0, 15))
  })

  it('parses an ISO-8601 string', () => {
    expect(parseNhtsaYMD('2024-01-15').getFullYear()).toBe(2024)
  })

  it('returns epoch for null or undefined', () => {
    expect(parseNhtsaYMD(null)).toEqual(new Date(0))
    expect(parseNhtsaYMD(undefined)).toEqual(new Date(0))
  })

  it('returns epoch for unrecognised input', () => {
    expect(parseNhtsaYMD('not a date')).toEqual(new Date(0))
  })
})

describe('parseNhtsaDMY', () => {
  it('parses the live recallsByVehicle "DD/MM/YYYY" format', () => {
    // Confirmed against the live API: "14/03/2024" is March 14, 2024.
    expect(parseNhtsaDMY('14/03/2024')).toEqual(new Date(2024, 2, 14))
  })

  it('parses a day past the 12-month bound, proving day-first order', () => {
    // If this were misread as month-first, "27/01/2026" would overflow
    // month 27 and roll into a later year — the exact regression this
    // guards against.
    expect(parseNhtsaDMY('27/01/2026')).toEqual(new Date(2026, 0, 27))
  })

  it('parses single-digit day/month', () => {
    expect(parseNhtsaDMY('5/1/2020')).toEqual(new Date(2020, 0, 5))
  })

  it('returns epoch for null or undefined', () => {
    expect(parseNhtsaDMY(null)).toEqual(new Date(0))
    expect(parseNhtsaDMY(undefined)).toEqual(new Date(0))
  })

  it('returns epoch for the legacy Microsoft "/Date(ms)/" format — no longer emitted by the live API', () => {
    expect(parseNhtsaDMY('/Date(1697500800000)/')).toEqual(new Date(0))
  })

  it('returns epoch for unrecognised input', () => {
    expect(parseNhtsaDMY('not a date')).toEqual(new Date(0))
  })
})
