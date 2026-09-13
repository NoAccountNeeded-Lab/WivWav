// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/en/filters',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => {
    const labels: Record<string, string> = {
      personalizedHeading: 'Personalized for you',
      browseAllSummary: 'Browse all available vehicles.',
      searchResultsLabel: 'Search results',
      noVehicles: 'No vehicles match your current filters.',
      noVehiclesForBrand: 'No vehicles match the selected conversion brand.',
      noListingsYet: 'No vehicles are listed yet. Check back soon.',
      backToHome: 'Back to home',
      clearAllFilters: 'Clear all filters',
      searchUnavailableHeading: 'Search unavailable',
      searchUnavailableMessage: 'Try again shortly.',
      'pagination.ariaLabel': 'Pagination',
      'pagination.previous': 'Previous',
      'pagination.next': 'Next',
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
vi.mock('@/components/SearchFilters', () => ({
  SortSelect: () => <div aria-label="Sort select" />,
}))
vi.mock('@/components/ActiveFilters', () => ({
  ActiveFilters: () => <div aria-label="Active filters" />,
}))
vi.mock('@/components/ListingsVisitSession', () => ({
  ListingsVisitSession: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/CategoryBarChart', () => ({
  CategoryBarChart: () => <div data-testid="category-bar-chart" />,
}))

const fetchListingsMock = vi.fn()
vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => fetchListingsMock(...args),
}))

function mockListingsResponse(total: number) {
  fetchListingsMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [],
      pagination: { page: 1, perPage: 24, total, totalPages: total > 0 ? 1 : 0 },
    }),
  })
}

afterEach(() => {
  cleanup()
  fetchListingsMock.mockReset()
})

describe('ListingsResults empty states', () => {
  it('hides facets and the clear-filters link for a truly empty catalog', async () => {
    mockListingsResponse(0)
    const { ListingsResults } = await import('./page')
    const element = await ListingsResults({
      searchParams: Promise.resolve({}),
      locale: 'en',
      resultsPath: '/en/filters',
    })
    render(element)

    expect(screen.queryByTestId('category-bar-chart')).toBeNull()
    expect(screen.getByText('No vehicles are listed yet. Check back soon.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Clear all filters' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/en')
  })

  it('keeps facets and the clear-filters link for a filtered-to-zero result', async () => {
    mockListingsResponse(0)
    const { ListingsResults } = await import('./page')
    const element = await ListingsResults({
      searchParams: Promise.resolve({ make: 'Ford' }),
      locale: 'en',
      resultsPath: '/en/filters',
    })
    render(element)

    expect(screen.getByTestId('category-bar-chart')).toBeTruthy()
    expect(screen.getByText('No vehicles match your current filters.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Clear all filters' })).toBeTruthy()
  })
})
