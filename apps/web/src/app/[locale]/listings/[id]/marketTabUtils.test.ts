import { describe, expect, it } from 'vitest'
import { pricePositionPercent } from './marketTabUtils.js'

describe('pricePositionPercent', () => {
  const band = { p10: 10_000_00, p90: 30_000_00 }

  it('returns null when priceCents is null', () => {
    expect(pricePositionPercent(null, band)).toBeNull()
  })

  it('returns null when the band has zero width', () => {
    expect(pricePositionPercent(20_000_00, { p10: 15_000_00, p90: 15_000_00 })).toBeNull()
  })

  it('places the median of the band at 50%', () => {
    expect(pricePositionPercent(20_000_00, band)).toBeCloseTo(50)
  })

  it('places p10 at 0%', () => {
    expect(pricePositionPercent(10_000_00, band)).toBe(0)
  })

  it('places p90 at 100%', () => {
    expect(pricePositionPercent(30_000_00, band)).toBe(100)
  })

  it('clamps a price below p10 to 0%', () => {
    expect(pricePositionPercent(5_000_00, band)).toBe(0)
  })

  it('clamps a price above p90 to 100%', () => {
    expect(pricePositionPercent(50_000_00, band)).toBe(100)
  })
})
