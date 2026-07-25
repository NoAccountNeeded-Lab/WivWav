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

    expect(screen.getByText('$18,000')).toBeTruthy() // p50 label
    expect(screen.getByText(/50% below median|50% above median|median/)).toBeTruthy()
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
