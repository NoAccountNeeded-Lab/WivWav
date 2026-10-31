// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import { DiscoverFacetGrid } from './DiscoverFacetGrid'

const state = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), usePathname: () => '/en/discover', useSearchParams: () => state.params }))
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="map" /> }))
vi.mock('@/components/PriceHistogram', () => ({ PriceHistogram: () => <div data-facet-test="price" /> }))
vi.mock('@/components/YearHistogram', () => ({ YearHistogram: () => <div data-facet-test="year" /> }))
vi.mock('@/components/MileageHistogram', () => ({ MileageHistogram: () => <div data-facet-test="mileage" /> }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => { state.push.mockClear(); state.params = new URLSearchParams() })

const bars = (...pairs: Array<[string, number]>) => pairs.map(([value, count]) => ({ value, count }))
const payload = {
  shoppingFiltersReady: true,
  makeBreakdown: bars(['Ford', 5], ['Toyota', 3]),
  modelBreakdown: bars(['Transit', 2]),
  conversionBreakdown: bars(['side_entry', 4], ['rear_entry', 2]),
  wheelchairCapacityBreakdown: bars(['1', 6]),
  stateBreakdown: bars(['IL', 4], ['DC', 1]),
  transmissionBreakdown: bars(['automatic', 6]),
  colorBreakdown: bars(['Burgundy', 2], ['Red', 3], ['White', 1]),
}

function stubFetch(handler?: (url: URL) => unknown) {
  const mock = vi.fn(async (input: string, init?: { signal?: AbortSignal }) => {
    const url = new URL(input)
    if (url.pathname.endsWith('conversion-brands')) return { ok: true, json: async () => ({ data: [] }) }
    if (handler) return handler(url)
    void init
    return { ok: true, json: async () => ({ data: payload }) }
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

const facetCalls = (mock: ReturnType<typeof stubFetch>) =>
  mock.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/facets'))

describe('DiscoverFacetGrid', () => {
  it('requests categorical data once through a single owner', async () => {
    const mock = stubFetch()
    await act(async () => { renderWithIntl(<DiscoverFacetGrid />) })
    await screen.findByRole('button', { name: 'Entry type' })
    expect(facetCalls(mock)).toHaveLength(1)
    expect(mock.mock.calls.filter(([url]) => String(url).includes('conversion-brands'))).toHaveLength(1)
  })

  it('keeps mobility facets first and location text alternatives visible, in DOM order', async () => {
    stubFetch()
    await act(async () => { renderWithIntl(<DiscoverFacetGrid />) })
    await screen.findByRole('button', { name: 'Entry type' })
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings.indexOf('Entry type')).toBeLessThan(headings.indexOf('Wheelchair capacity'))
    expect(headings.indexOf('Wheelchair capacity')).toBeLessThan(headings.indexOf('Make'))
    expect(headings.indexOf('Make')).toBeLessThan(headings.indexOf('Location'))
    expect(headings.indexOf('Location')).toBeLessThan(headings.indexOf('Transmission'))
    const group = screen.getByRole('group', { name: 'Choose states by name' })
    expect(group.textContent).toContain('District of Columbia')
    expect(group.textContent).toContain('Illinois')
  })

  it('toggles a state from the text alternative while preserving other filters and resetting the page', async () => {
    state.params = new URLSearchParams('make=Ford&page=3')
    stubFetch()
    await act(async () => { renderWithIntl(<DiscoverFacetGrid />) })
    fireEvent.click(await screen.findByRole('button', { name: /Illinois/ }))
    const next = new URL(state.push.mock.calls[0]![0] as string, 'https://example.test')
    expect(next.searchParams.get('state')).toBe('IL')
    expect(next.searchParams.get('make')).toBe('Ford')
    expect(next.searchParams.has('page')).toBe(false)
  })

  it('aborts the obsolete request when the query changes', async () => {
    const signals: AbortSignal[] = []
    const mock = vi.fn(async (input: string, init?: { signal?: AbortSignal }) => {
      if (new URL(input).pathname.endsWith('conversion-brands')) return { ok: true, json: async () => ({ data: [] }) }
      if (init?.signal) signals.push(init.signal)
      return new Promise(() => {})
    })
    vi.stubGlobal('fetch', mock)
    const view = renderWithIntl(<DiscoverFacetGrid />)
    await waitFor(() => expect(signals).toHaveLength(1))
    state.params = new URLSearchParams('make=Ford')
    await act(async () => { view.rerender(<DiscoverFacetGrid />) })
    expect(signals[0]!.aborted).toBe(true)
  })

  it('keeps headings and selected zero-count options, and says counts are unavailable, when the API fails', async () => {
    state.params = new URLSearchParams('make=Ford&state=IL')
    stubFetch(() => ({ ok: false, status: 503, json: async () => ({}) }))
    await act(async () => { renderWithIntl(<DiscoverFacetGrid />) })
    expect(await screen.findByRole('button', { name: 'Make' })).toBeTruthy()
    expect((await screen.findByRole('button', { name: /Ford/ })).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByText(/Counts are unavailable/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Illinois/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows color families, selects every raw member, and treats an old raw-color link as selected', async () => {
    state.params = new URLSearchParams('color=Burgundy')
    stubFetch()
    await act(async () => { renderWithIntl(<DiscoverFacetGrid />) })
    const red = await screen.findByRole('button', { name: /^Red:/ })
    expect(red.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(red)
    const cleared = new URL(state.push.mock.calls[0]![0] as string, 'https://example.test')
    expect(cleared.searchParams.has('color')).toBe(false)
  })
})
