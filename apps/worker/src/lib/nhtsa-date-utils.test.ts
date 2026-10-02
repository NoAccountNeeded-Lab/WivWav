import { describe, expect, it } from 'vitest'
import { parseNhtsaDMY, parseNhtsaYMD } from './nhtsa-date-utils.js'

const EPOCH = new Date(0).getTime()

describe('parseNhtsaYMD', () => {
  it('parses YYYYMMDD as number or string', () => {
    expect(parseNhtsaYMD(20240115).getTime()).toBe(new Date(2024, 0, 15).getTime())
    expect(parseNhtsaYMD(' 20241231 ').getTime()).toBe(new Date(2024, 11, 31).getTime())
  })

  it('parses ISO-8601 strings', () => {
    expect(parseNhtsaYMD('2024-03-14T00:00:00.000Z').toISOString()).toBe('2024-03-14T00:00:00.000Z')
  })

  it('returns the epoch for null, undefined, and garbage', () => {
    expect(parseNhtsaYMD(null).getTime()).toBe(EPOCH)
    expect(parseNhtsaYMD(undefined).getTime()).toBe(EPOCH)
    expect(parseNhtsaYMD('not a date').getTime()).toBe(EPOCH)
  })
})

describe('parseNhtsaDMY', () => {
  it('parses day-first dates', () => {
    expect(parseNhtsaDMY('14/03/2024').getTime()).toBe(new Date(2024, 2, 14).getTime())
    expect(parseNhtsaDMY(' 1/2/2023 ').getTime()).toBe(new Date(2023, 1, 1).getTime())
  })

  it('returns the epoch for empty or malformed input', () => {
    expect(parseNhtsaDMY(null).getTime()).toBe(EPOCH)
    expect(parseNhtsaDMY('').getTime()).toBe(EPOCH)
    expect(parseNhtsaDMY('/Date(1710374400000)/').getTime()).toBe(EPOCH)
    expect(parseNhtsaDMY('2024-03-14').getTime()).toBe(EPOCH)
  })
})
