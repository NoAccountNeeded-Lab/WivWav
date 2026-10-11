import type { PricePoint } from '@/app/[locale]/listings/[id]/types'
import { hasValueChange } from './hasValueChange'

/**
 * Builds an SVG `points` attribute value tracing `priceHistory` across a
 * `width`×`height` viewBox, normalized so the lowest recorded price sits at
 * the bottom and the highest at the top. Returns '' when the
 * prices never change (nothing to trace).
 */
export function sparklinePoints(priceHistory: PricePoint[], width: number, height: number): string {
  const values = priceHistory.map((pt) => pt.priceCents)
  if (!hasValueChange(values)) return ''

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min

  return values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - ((value - min) / range) * height
      return `${x},${y}`
    })
    .join(' ')
}
