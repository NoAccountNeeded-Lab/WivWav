// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import { PriceHistogram } from './PriceHistogram'
import { YearHistogram } from './YearHistogram'
import { MileageHistogram } from './MileageHistogram'

const state = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/es/discover', useSearchParams: () => state.params }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() { return undefined }
    unobserve() { return undefined }
    disconnect() { return undefined }
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('cross-filtered histogram query forwarding', () => {
  it.each([
    { Component: PriceHistogram, omitted: ['priceMin', 'priceMax'] },
    { Component: YearHistogram, omitted: ['yearMin', 'yearMax'] },
    { Component: MileageHistogram, omitted: ['mileageMax'] },
  ])('forwards trim and every shopping constraint while omitting only $omitted', async ({ Component, omitted }) => {
    const filters = { q: 'van', make: 'Ford', model: 'Transit', trim: 'LE', state: 'IL', city: 'springfield|MO,portland|OR', transmission: 'automatic,cvt', wheelchairCapacity: '1,2', conversionStatus: 'proposed,unknown', yearMin: '2010', yearMax: '2020', priceMin: '100000', priceMax: '5000000', mileageMax: '50000' }
    state.params = new URLSearchParams(filters)
    const fetchMock = vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { renderWithIntl(<Component />) })
    const requested = new URL(String(fetchMock.mock.calls[0]![0]))
    const expected = Object.fromEntries(Object.entries(filters).filter(([key]) => !omitted.includes(key)))
    expect(Object.fromEntries(requested.searchParams)).toEqual(expected)
  })
})
