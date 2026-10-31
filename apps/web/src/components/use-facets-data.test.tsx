// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFacetsData } from './use-facets-data'

const state = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => state.params }))

type Resolver = (value: unknown) => void
let pending: Array<{ url: URL; resolve: Resolver; reject: (e: Error) => void }> = []

function stubFetch() {
  pending = []
  const mock = vi.fn((input: string) => {
    const url = new URL(input)
    if (url.pathname.endsWith('conversion-brands')) return Promise.resolve({ ok: true, json: async () => ({ data: [] }) })
    return new Promise((resolve, reject) => { pending.push({ url, resolve, reject }) })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
const find = (pred: (u: URL) => boolean) => pending.filter((p) => pred(p.url))

beforeEach(() => { state.params = new URLSearchParams() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('useFacetsData', () => {
  it('sends one request per distinct URL: active filters add disjunctive and own-range calls only', async () => {
    const mock = stubFetch()
    state.params = new URLSearchParams('make=Ford&state=IL&priceMin=100')
    renderHook(() => useFacetsData())
    const facets = mock.mock.calls.map(([url]) => new URL(url)).filter((u) => u.pathname.endsWith('/facets'))
    // base + make-omitted + state-omitted + price-range-omitted; year and mileage share the base request.
    expect(facets).toHaveLength(4)
    expect(new Set(facets.map(String)).size).toBe(4)

    cleanup()
    const mock2 = stubFetch()
    state.params = new URLSearchParams()
    renderHook(() => useFacetsData())
    expect(mock2.mock.calls.filter(([url]) => String(url).includes('/facets'))).toHaveLength(1)
  })

  it('ignores a late response from an obsolete query', async () => {
    stubFetch()
    state.params = new URLSearchParams('make=Ford')
    const { result, rerender } = renderHook(() => useFacetsData())
    const firstBase = find((u) => u.searchParams.get('make') === 'Ford' && u.searchParams.size === 1)[0]!
    state.params = new URLSearchParams('make=Toyota')
    rerender()
    const secondBase = find((u) => u.searchParams.get('make') === 'Toyota')[0]!
    await act(async () => { secondBase.resolve(ok({ total: 2 })) })
    await act(async () => { find((u) => u.searchParams.get('make') === null && u.searchParams.size === 0).forEach((p) => p.resolve(ok({ total: 2 }))) })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { firstBase.resolve(ok({ total: 99 })) })
    expect(result.current.data?.total).toBe(2)
  })

  it('does not make histograms wait for the slowest request', async () => {
    stubFetch()
    state.params = new URLSearchParams('make=Ford&priceMin=100')
    const { result } = renderHook(() => useFacetsData())
    const priceRange = find((u) => u.searchParams.has('make') && !u.searchParams.has('priceMin'))
    // The make-omitted disjunctive call has priceMin; the price-range call has make but no priceMin.
    await act(async () => { priceRange[0]!.resolve(ok({ total: 7, priceDistribution: [{ bucket: '0-5000', count: 7 }] })) })
    expect(result.current.status).toBe('loading')
    expect(result.current.ranges.price?.priceDistribution).toHaveLength(1)
  })

  it('keeps the previous slice when only a disjunctive or range request fails, and needs the base', async () => {
    stubFetch()
    state.params = new URLSearchParams('make=Ford')
    const { result } = renderHook(() => useFacetsData())
    const settle = async (fn: (p: (typeof pending)[number]) => void) => { await act(async () => { pending.forEach(fn) }) }
    await settle((p) => p.resolve(ok({ makeBreakdown: [{ value: 'Ford', count: 3 }], total: 3 })))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data?.makeBreakdown[0]).toEqual({ value: 'Ford', count: 3 })

    cleanup()
    // Fresh owner on a query with a disjunctive facet: base ok, every other request fails.
    pending = []
    state.params = new URLSearchParams('make=Ford&color=Red')
    const owner = renderHook(() => useFacetsData())
    const base = find((u) => u.searchParams.has('make') && u.searchParams.has('color'))[0]!
    const others = pending.filter((p) => p !== base)
    await act(async () => {
      base.resolve(ok({ makeBreakdown: [{ value: 'Ford', count: 1 }] }))
      others.forEach((p) => p.reject(new Error('boom')))
    })
    await waitFor(() => expect(owner.result.current.status).toBe('ready'))
    expect(owner.result.current.data?.makeBreakdown[0]).toEqual({ value: 'Ford', count: 1 })

    cleanup()
    pending = []
    const failed = renderHook(() => useFacetsData())
    await act(async () => { pending.forEach((p) => p.reject(new Error('down'))) })
    await waitFor(() => expect(failed.result.current.status).toBe('unavailable'))
  })
})
