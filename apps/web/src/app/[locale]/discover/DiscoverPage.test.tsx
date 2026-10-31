// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import { DiscoverPage } from './DiscoverPage'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('make=Ford'),
}))

vi.mock('./DiscoverFacetGrid', () => ({
  DiscoverFacetGrid: () => <div data-testid="facet-grid" />,
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
    expect(screen.getByRole('region', { name: 'Vehicle filters' })).toBeTruthy()
    expect(screen.getByTestId('facet-grid')).toBeTruthy()

    expect(screen.queryByRole('log')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('link', { name: 'See Matches →' }).getAttribute('href'))
      .toBe('/en/results?make=Ford')
    expect(screen.getByRole('link', { name: 'Browse all vehicles' }).getAttribute('href'))
      .toBe('/en/results')
  })

  it('renders the discover flow in Spanish', () => {
    renderWithIntl(<DiscoverPage resultsPath="/es/results" />, 'es')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Encuentre el vehículo accesible adecuado' }),
    ).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Filtros de vehículos' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver coincidencias →' }).getAttribute('href')).toBe(
      '/es/results?make=Ford',
    )
  })
})
