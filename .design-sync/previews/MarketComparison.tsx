import { MarketComparison } from '@wivwav/web'
import type { MarketPricing, PricePoint } from '@wivwav/web'

const marketPricing: MarketPricing = {
  count: 34,
  priceCents: {
    p10: 1890000,
    p25: 2340000,
    p50: 2890000,
    p75: 3420000,
    p90: 3980000,
  },
  medianDaysListed: 41,
  priceDropRate: 0.28,
}

const priceHistory: PricePoint[] = [
  { id: 'h1', priceCents: 3199900, recordedAt: '2026-04-02T00:00:00Z' },
  { id: 'h2', priceCents: 3099900, recordedAt: '2026-05-10T00:00:00Z' },
  { id: 'h3', priceCents: 2989900, recordedAt: '2026-06-18T00:00:00Z' },
]

export function BelowMedian() {
  return (
    <MarketComparison
      priceCents={2550000}
      make="Toyota"
      model="Sienna"
      marketPricing={marketPricing}
      priceHistory={priceHistory}
    />
  )
}

export function AboveMedian() {
  return (
    <MarketComparison
      priceCents={3650000}
      make="Toyota"
      model="Sienna"
      marketPricing={marketPricing}
      priceHistory={priceHistory}
    />
  )
}

export function NoPriceHistory() {
  return (
    <MarketComparison
      priceCents={2890000}
      make="Honda"
      model="Odyssey"
      marketPricing={marketPricing}
      priceHistory={[]}
    />
  )
}
