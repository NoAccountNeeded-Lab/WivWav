// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarketTab } from './MarketTab'
import { OverviewTab } from './OverviewTab'
import type { ListingDetail, PricePoint } from './types'

vi.mock('@/components/listing/PriceHistoryChart', () => ({
  PriceHistoryChart: () => <div data-testid="chart" />,
}))
vi.mock('@/components/listing/PriceSparkline', () => ({
  PriceSparkline: () => <div data-testid="sparkline" />,
}))
vi.mock('@/components/listing/MarketComparison', () => ({ MarketComparison: () => null }))
vi.mock('@/components/listing/SimilarListings', () => ({ SimilarListings: () => null }))
vi.mock('@/components/listing/DealerCard', () => ({ DealerCard: () => null }))
vi.mock('@/components/listing/DealerReputation', () => ({ DealerReputation: () => null }))
vi.mock('./ReportListingForm', () => ({ ReportListingForm: () => null }))

afterEach(() => cleanup())

const listing = {
  id: 'l1',
  priceCents: 2_000_000,
  condition: 'used',
  mileage: 40_000,
  listedAt: '2026-01-01T00:00:00.000Z',
  sourceListedAt: null,
  dealer: { name: null, phone: null, website: null },
  location: { city: null, state: null },
  crossListings: [],
} as unknown as ListingDetail

const p = (priceCents: number, day: number): PricePoint => ({
  id: String(day),
  priceCents,
  recordedAt: `2026-02-0${day}T00:00:00.000Z`,
})
const flat = [p(2_000_000, 1), p(2_000_000, 2), p(2_000_000, 3)]
const dropped = [p(2_200_000, 1), p(2_000_000, 2)]

function renderMarket(priceHistory: PricePoint[]) {
  renderWithIntl(
    <MarketTab listing={listing} marketPricing={null} priceHistory={priceHistory} vinHistory={[]} similar={[]} />,
  )
}

function renderOverview(priceHistory: PricePoint[]) {
  renderWithIntl(<OverviewTab listing={listing} priceHistory={priceHistory} apiBaseUrl="" />)
}

describe('MarketTab price history gate', () => {
  it.each([
    ['no entries', []],
    ['one entry', [p(2_000_000, 1)]],
    ['identical entries', flat],
  ])('hides the section and heading with %s', (_l, history) => {
    renderMarket(history)
    expect(screen.queryByTestId('chart')).toBeNull()
    expect(screen.queryByText('Price history')).toBeNull()
  })

  it('shows the chart when prices differ', () => {
    renderMarket(dropped)
    expect(screen.getByTestId('chart')).toBeTruthy()
    expect(screen.getByText('Price history')).toBeTruthy()
  })
})

describe('OverviewTab price history gate', () => {
  it.each([
    ['no entries', []],
    ['one entry', [p(2_000_000, 1)]],
    ['identical entries', flat],
  ])('hides the sparkline with %s', (_l, history) => {
    renderOverview(history)
    expect(screen.queryByTestId('sparkline')).toBeNull()
  })

  it('shows the sparkline and reduced-on note for a real drop', () => {
    renderOverview(dropped)
    expect(screen.getByTestId('sparkline')).toBeTruthy()
    expect(screen.getByText(/reduced/i)).toBeTruthy()
  })
})
