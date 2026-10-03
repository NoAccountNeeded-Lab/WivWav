// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import { ActiveFilters } from './ActiveFilters'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/filters',
  useSearchParams: () =>
    new URLSearchParams('make=Ford,Toyota,Honda&priceMax=3000000&wavFeatures=has_lift&mileageMax=60000'),
}))

afterEach(() => cleanup())

describe('ActiveFilters', () => {
  it('renders search filter pills and their accessible names in English', () => {
    renderWithIntl(<ActiveFilters />)

    expect(screen.getByRole('list', { name: 'Active filters' })).toBeTruthy()
    expect(screen.getByText('3 makes')).toBeTruthy()
    expect(screen.getByText('Up to $30k')).toBeTruthy()
    expect(screen.getByText('Under 60,000 mi')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove make filter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeTruthy()
  })

  it('renders search filter pills and their accessible names in Spanish', () => {
    renderWithIntl(<ActiveFilters />, 'es')

    expect(screen.getByRole('list', { name: 'Filtros activos' })).toBeTruthy()
    expect(screen.getByText('3 marcas')).toBeTruthy()
    expect(screen.getByText('Hasta $30k')).toBeTruthy()
    expect(screen.getByText('Menos de 60,000 mi')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Quitar el filtro de marca' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Quitar el filtro de precio' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Borrar todos los filtros' })).toBeTruthy()
  })
})
