import { describe, expect, it } from 'vitest'
import { sparklinePoints } from './priceSparklineUtils.js'
import type { PricePoint } from '@/app/[locale]/listings/[id]/types'

function point(priceCents: number, recordedAt = '2026-01-01T00:00:00.000Z'): PricePoint {
  return { id: `${priceCents}`, priceCents, recordedAt }
}

describe('sparklinePoints', () => {
  it('returns an empty string with no price change', () => {
    expect(sparklinePoints([], 100, 20)).toBe('')
    expect(sparklinePoints([point(1000)], 100, 20)).toBe('')
    expect(sparklinePoints([point(5000), point(5000), point(5000)], 100, 20)).toBe('')
  })

  it('maps the lowest price to the bottom and highest to the top', () => {
    const result = sparklinePoints([point(1000), point(2000)], 100, 20)
    const coords = result.split(' ').map((pair) => pair.split(',').map(Number))
    expect(coords[0]).toEqual([0, 20]) // lowest price -> bottom (y = height)
    expect(coords[1]).toEqual([100, 0]) // highest price -> top (y = 0)
  })

  it('spaces points evenly across the width', () => {
    const result = sparklinePoints([point(1000), point(1500), point(2000)], 100, 20)
    const xs = result.split(' ').map((pair) => Number(pair.split(',')[0]))
    expect(xs).toEqual([0, 50, 100])
  })
})
