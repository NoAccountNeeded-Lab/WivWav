// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import { ActiveFilters } from './ActiveFilters'

const state = vi.hoisted(() => ({ params: 'make=Ford,Toyota,Honda&priceMax=3000000&wavFeatures=has_lift&mileageMax=60000', push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  usePathname: () => '/filters',
  useSearchParams: () =>
    new URLSearchParams(state.params),
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


describe('shopping filter chips', () => {
  it('renders and individually removes a city conflicting with the explicit state', () => {
    state.params = 'state=IL&city=springfield%7CMO,portland%7COR&transmission=automatic&wheelchairCapacity=2&conversionStatus=unknown&page=3'
    renderWithIntl(<ActiveFilters />)
    expect(screen.getByText('2 wheelchair spaces')).toBeTruthy()
    expect(screen.getByText('Unknown')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Springfield, MO filter' }))
    const next = new URL(state.push.mock.calls.at(-1)![0] as string, 'https://example.test')
    expect(Object.fromEntries(next.searchParams)).toEqual({ state: 'IL', city: 'portland|OR', transmission: 'automatic', wheelchairCapacity: '2', conversionStatus: 'unknown' })
  })
})


describe('localized shopping chips', () => {
  it('translates conversion status and transmission while retaining CVT', () => {
    state.params = 'transmission=automatic,cvt&conversionStatus=proposed,complete,unknown'
    renderWithIntl(<ActiveFilters />, 'es')
    expect(screen.getByText('Automática')).toBeTruthy()
    expect(screen.getByText('CVT')).toBeTruthy()
    expect(screen.getByText('Propuesta')).toBeTruthy()
    expect(screen.getByText('Completa')).toBeTruthy()
    expect(screen.getByText('Desconocida')).toBeTruthy()
  })
  it('keeps an accepted 100-character city label and its removal accessible', () => {
    const city = 'a'.repeat(100)
    state.params = new URLSearchParams({ city: `${city}|MO` }).toString()
    renderWithIntl(<ActiveFilters />)
    const label = `${'A'}${'a'.repeat(99)}, MO`
    expect(screen.getByRole('button', { name: `Remove ${label} filter` })).toBeTruthy()
  })
})
