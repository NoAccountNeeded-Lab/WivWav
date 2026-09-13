// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => {
    const labels: Record<string, string> = {
      sectionTitle: 'Discover',
      heading: 'Find the right accessible vehicle',
      noListingsYet: 'No vehicles are listed yet. Check back soon.',
    }
    return labels[key] ?? key
  },
}))

vi.mock('@/lib/api-url', () => ({
  getServerApiBaseUrl: () => 'http://api.test',
  getClientApiBaseUrl: () => 'http://api.test',
}))

vi.mock('@/components/SiteHeader', () => ({
  SiteHeader: () => <header aria-label="Site header" />,
}))
vi.mock('@/components/ActiveFilters', () => ({
  ActiveFilters: () => <div aria-label="Active filters" />,
}))
vi.mock('@/components/CategoryBarChart', () => ({
  CategoryBarChart: () => <div data-testid="category-bar-chart" />,
}))
vi.mock('@/components/PriceHistogram', () => ({
  PriceHistogram: () => <div data-testid="price-histogram" />,
}))
vi.mock('@/components/YearHistogram', () => ({
  YearHistogram: () => <div data-testid="year-histogram" />,
}))
vi.mock('@/components/MileageHistogram', () => ({
  MileageHistogram: () => <div data-testid="mileage-histogram" />,
}))

const fetchListingsMock = vi.fn()
vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => fetchListingsMock(...args),
}))

function mockTotal(total: number) {
  fetchListingsMock.mockResolvedValue({
    ok: true,
    json: async () => ({ pagination: { page: 1, perPage: 1, total, totalPages: total > 0 ? 1 : 0 } }),
  })
}

afterEach(() => {
  cleanup()
  fetchListingsMock.mockReset()
})

describe('DiscoverRoute empty catalog', () => {
  it('shows an empty-catalog message instead of the filter widgets when the catalog is empty', async () => {
    mockTotal(0)
    const { default: DiscoverRoute } = await import('./page')
    const element = await DiscoverRoute({ params: Promise.resolve({ locale: 'en' }) })
    render(element)

    expect(screen.getByText('No vehicles are listed yet. Check back soon.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Discover' })).toBeTruthy()
    expect(screen.queryByTestId('category-bar-chart')).toBeNull()
    expect(screen.queryByTestId('price-histogram')).toBeNull()
  })

  it('renders the filter widgets when the catalog has listings', async () => {
    mockTotal(42)
    const { default: DiscoverRoute } = await import('./page')
    const element = await DiscoverRoute({ params: Promise.resolve({ locale: 'en' }) })
    render(element)

    expect(screen.getAllByTestId('category-bar-chart').length).toBeGreaterThan(0)
    expect(screen.getByTestId('price-histogram')).toBeTruthy()
    expect(screen.queryByText('No vehicles are listed yet. Check back soon.')).toBeNull()
  })

  it('fails open (shows filter widgets) when the catalog check errors', async () => {
    fetchListingsMock.mockRejectedValue(new Error('network down'))
    const { default: DiscoverRoute } = await import('./page')
    const element = await DiscoverRoute({ params: Promise.resolve({ locale: 'en' }) })
    render(element)

    expect(screen.getAllByTestId('category-bar-chart').length).toBeGreaterThan(0)
  })
})
