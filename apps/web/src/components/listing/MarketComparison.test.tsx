// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarketComparison } from './MarketComparison'
import type { MarketPricing } from '@/app/[locale]/listings/[id]/types'

afterEach(() => cleanup())

const marketPricing: MarketPricing = {
  count: 12,
  priceCents: { p10: 10_000_00, p25: 14_000_00, p50: 18_000_00, p75: 22_000_00, p90: 26_000_00 },
  medianDaysListed: 30,
  priceDropRate: null,
}

describe('MarketComparison', () => {
  it('renders a position indicator when a price and market band are present', () => {
    render(
      <MarketComparison
        priceCents={18_000_00}
        make="Toyota"
        model="Sienna"
        marketPricing={marketPricing}
        priceHistory={[]}
      />,
    )

    const band = screen.getByRole('img', { name: /positioned at/ })
    expect(band.getAttribute('aria-label')).toMatch(/50% of the way/)
  })

  it('omits the position indicator when priceCents is null', () => {
    render(
      <MarketComparison
        priceCents={null}
        make="Toyota"
        model="Sienna"
        marketPricing={marketPricing}
        priceHistory={[]}
      />,
    )

    expect(screen.queryByRole('img', { name: /positioned at/ })).toBeNull()
  })

  it('still renders the existing percentile labels alongside the new indicator', () => {
    render(
      <MarketComparison
        priceCents={18_000_00}
        make="Toyota"
        model="Sienna"
        marketPricing={marketPricing}
        priceHistory={[]}
      />,
    )

    // Two separate labels: the p50 percentile amount in the .labels row, and
    // the pctVsMedian callout text. priceCents === mp.p50 here, so the
    // callout is pinned to exactly "0% below median" (pctVsMedian >= 0 branch).
    expect(screen.getAllByText('$18,000').length).toBeGreaterThanOrEqual(1) // p50 label
    expect(screen.getByText(/0% below median/)).toBeTruthy()
  })

  it('renders nothing when marketPricing has no priceCents band', () => {
    const { container } = render(
      <MarketComparison
        priceCents={18_000_00}
        make="Toyota"
        model="Sienna"
        marketPricing={{ ...marketPricing, priceCents: null }}
        priceHistory={[]}
      />,
    )

    expect(container.textContent).toBe('')
  })
})
