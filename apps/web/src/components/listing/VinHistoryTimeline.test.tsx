// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { VinHistoryEntry } from '@wivwav/types'
import {
  buildVinHistoryChartData,
  hasMultiListingVinHistory,
  VinHistoryTimeline,
} from './VinHistoryTimeline'

afterEach(() => {
  cleanup()
})

const multiListingHistory: VinHistoryEntry[] = [
  { listingId: 'listing-1', type: 'price', value: 4200000, recordedAt: '2026-01-01T00:00:00.000Z' },
  { listingId: 'listing-1', type: 'mileage', value: 30000, recordedAt: '2026-01-01T00:00:00.000Z' },
  { listingId: 'listing-2', type: 'price', value: 4050000, recordedAt: '2026-03-01T00:00:00.000Z' },
  { listingId: 'listing-2', type: 'mileage', value: 31500, recordedAt: '2026-03-01T00:00:00.000Z' },
]

describe('hasMultiListingVinHistory', () => {
  it('should require observations from at least two listings', () => {
    expect(hasMultiListingVinHistory(multiListingHistory)).toBe(true)
    expect(hasMultiListingVinHistory(multiListingHistory.slice(0, 2))).toBe(false)
  })
})

describe('buildVinHistoryChartData', () => {
  it('should split current-listing and other-listing observations into separate series', () => {
    const data = buildVinHistoryChartData(multiListingHistory, 'listing-1')

    expect(data[0]).toMatchObject({
      listingLabel: 'This listing',
      currentPriceCents: 4200000,
      otherPriceCents: null,
    })
    expect(data[2]).toMatchObject({
      listingLabel: 'Other listing',
      currentPriceCents: null,
      otherPriceCents: 4050000,
    })
  })
})

describe('VinHistoryTimeline', () => {
  it('should render an accessible multi-listing timeline summary', () => {
    render(<VinHistoryTimeline history={multiListingHistory} currentListingId="listing-1" />)

    expect(screen.getByRole('img', { name: 'VIN price and mileage history across 2 listings' })).toBeDefined()
    expect(screen.getByText('4 observations across 2 listings for this VIN.')).toBeDefined()
    expect(screen.getByText('VIN price and mileage history')).toBeDefined()
    expect(screen.getAllByText('This listing').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Other listing').length).toBeGreaterThan(0)
  })

  it('should not render for a single-listing VIN history', () => {
    const { container } = render(
      <VinHistoryTimeline history={multiListingHistory.slice(0, 2)} currentListingId="listing-1" />,
    )

    expect(container.textContent).toBe('')
  })
})
