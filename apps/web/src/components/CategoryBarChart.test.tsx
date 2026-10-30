// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import { CategoryBarChart } from './CategoryBarChart'

const state = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), usePathname: () => '/en/discover', useSearchParams: () => state.params }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('./PriceHistogram', () => ({ PriceHistogram: () => null }))
vi.mock('./YearHistogram', () => ({ YearHistogram: () => null }))
vi.mock('./MileageHistogram', () => ({ MileageHistogram: () => null }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

beforeEach(() => {
  state.push.mockClear()
  state.params = new URLSearchParams({ state: 'IL', city: 'springfield|MO', wheelchairCapacity: '1', transmission: 'automatic', conversionStatus: 'proposed', make: 'Ford', page: '2' })
})

function mockFacets(ready = true) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input)
    if (url.pathname.endsWith('conversion-brands')) return { ok: true, json: async () => ({ data: [] }) }
    const cityOmitted = !url.searchParams.has('city')
    return { ok: true, json: async () => ({ data: { shoppingFiltersReady: ready, cityBreakdown: cityOmitted ? [{ value: 'chicago|IL', count: 4 }] : [], transmissionBreakdown: [{ value: 'automatic', count: 2 }], wheelchairCapacityBreakdown: [{ value: '1', count: 2 }, { value: '2', count: 1 }], conversionStatusBreakdown: [{ value: 'proposed', count: 2 }, { value: 'unknown', count: 1 }] } }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('shopping facet controls', () => {
  it('retains explicit state constraints in disjunctive calls and removable selected zero-count cities', async () => {
    const fetchMock = mockFacets()
    await act(async () => { renderWithIntl(<CategoryBarChart showMap={false} showHistograms={false} />) })
    const selected = await screen.findByRole('button', { name: /Springfield, MO/ })
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(selected.hasAttribute('disabled')).toBe(false)
    expect(await screen.findByRole('button', { name: /Chicago, IL/ })).toBeTruthy()
    const urls = fetchMock.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname.endsWith('/facets'))
    const disjunctiveCity = urls.find((url) => !url.searchParams.has('city'))
    expect(Object.fromEntries(disjunctiveCity!.searchParams)).toMatchObject({ state: 'IL', wheelchairCapacity: '1', transmission: 'automatic', conversionStatus: 'proposed', make: 'Ford' })
    fireEvent.click(selected)
    const next = new URL(state.push.mock.calls[0]![0] as string, 'https://example.test')
    expect(next.searchParams.has('city')).toBe(false)
    expect(next.searchParams.get('state')).toBe('IL')
    expect(next.searchParams.has('page')).toBe(false)
  })
  it('announces exact capacity and conversion status with selectable pressed-state buttons', async () => {
    mockFacets()
    await act(async () => { renderWithIntl(<CategoryBarChart showMap={false} showHistograms={false} />) })
    expect((await screen.findByRole('button', { name: /1 wheelchair space/ })).getAttribute('aria-pressed')).toBe('true')
    expect((await screen.findByRole('button', { name: /Proposed/ })).getAttribute('aria-pressed')).toBe('true')
    expect(await screen.findByRole('button', { name: /Unknown/ })).toBeTruthy()
  })
  it('withholds all new controls before verified rollout', async () => {
    const fetchMock = mockFacets(false)
    await act(async () => { renderWithIntl(<CategoryBarChart showMap={false} showHistograms={false} />) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('Wheelchair capacity')).toBeNull()
    expect(screen.queryByText('City')).toBeNull()
  })
})
