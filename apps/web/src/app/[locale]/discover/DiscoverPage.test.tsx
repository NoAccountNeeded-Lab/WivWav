// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import { DiscoverPage } from './DiscoverPage'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('make=Ford'),
}))

vi.mock('@/components/CategoryBarChart', () => ({
  CategoryBarChart: () => null,
}))
vi.mock('@/components/PriceHistogram', () => ({
  PriceHistogram: () => null,
}))
vi.mock('@/components/YearHistogram', () => ({
  YearHistogram: () => null,
}))
vi.mock('@/components/MileageHistogram', () => ({
  MileageHistogram: () => null,
}))
vi.mock('@/components/ActiveFilters', () => ({
  ActiveFilters: () => <div aria-label="Active filters" />,
}))

afterEach(() => cleanup())

describe('DiscoverPage', () => {
  it('shows the structured filters and result actions without a chat interface', () => {
    const resultsPath = '/en/results'
    renderWithIntl(<DiscoverPage resultsPath={resultsPath} />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Find the right accessible vehicle' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('complementary', { name: 'Filter by vehicle type and brand' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('complementary', { name: 'Filter by feature, location, seller, and fuel type' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('complementary', { name: 'Filter by price, year, and mileage' }),
    ).toBeTruthy()

    expect(screen.queryByRole('log')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('link', { name: 'See Matches →' }).getAttribute('href'))
      .toBe('/en/results?make=Ford')
    expect(screen.getByRole('link', { name: 'Browse all vehicles' }).getAttribute('href'))
      .toBe('/en/results')
  })
})
