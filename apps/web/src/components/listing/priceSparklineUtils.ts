import type { PricePoint } from '@/app/[locale]/listings/[id]/types'

/**
 * Builds an SVG `points` attribute value tracing `priceHistory` across a
 * `width`×`height` viewBox, normalized so the lowest recorded price sits at
 * the bottom and the highest at the top. A flat price history (min === max)
 * renders as a level line at mid-height rather than dividing by zero.
 */
export function sparklinePoints(priceHistory: PricePoint[], width: number, height: number): string {
  if (priceHistory.length < 2) return ''

  const values = priceHistory.map((pt) => pt.priceCents)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min

  return values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * width
      const y = range === 0 ? height / 2 : height - ((value - min) / range) * height
      return `${x},${y}`
    })
    .join(' ')
}
