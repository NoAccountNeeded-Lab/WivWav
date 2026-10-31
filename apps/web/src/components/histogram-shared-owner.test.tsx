// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import { normalizeFacetsData } from './category-facets'
import { PriceHistogram } from './PriceHistogram'
import { YearHistogram } from './YearHistogram'
import { MileageHistogram } from './MileageHistogram'
import { FacetsStateContext } from './use-facets-data'
import type { FacetsState } from './use-facets-data'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/en/discover', useSearchParams: () => new URLSearchParams() }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('histograms with a shared facet owner', () => {
  it('render from the owner and make no requests of their own', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const slice = normalizeFacetsData({
      total: 10,
      priceDistribution: [{ bucket: '50000-55000', count: 4 }, { bucket: '55000-60000', count: 6 }],
      yearDistribution: [{ year: 2020, count: 3 }, { year: 2022, count: 7 }],
      mileageDistribution: [{ bucket: '0-10000', count: 5 }],
    })
    const owner: FacetsState = { data: slice, brands: [], status: 'ready', ranges: { price: slice, year: slice, mileage: slice } }
    let container!: HTMLElement
    await act(async () => {
      container = renderWithIntl(
        <FacetsStateContext.Provider value={owner}>
          <PriceHistogram /><YearHistogram /><MileageHistogram />
        </FacetsStateContext.Provider>,
      ).container
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelectorAll('[role="slider"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[role="img"]').length).toBeGreaterThan(0)
  })
})
