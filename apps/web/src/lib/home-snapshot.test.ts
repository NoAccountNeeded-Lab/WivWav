import { describe, expect, it, vi } from 'vitest'
import { buildHomeSnapshot, fetchHomeSnapshot } from './home-snapshot'

const good = {
  total: 100,
  calculatedAt: '2026-10-31T08:00:00.000Z',
  priceDistribution: [{ bucket: '45000-50000', count: 40 }, { bucket: '50000-55000', count: 0 }, { bucket: 'bad', count: 5 }],
  stateBreakdown: [{ value: 'MO', count: 10 }, { value: 'TX', count: 30 }],
  conversionBreakdown: [{ value: 'side_entry', count: 50 }, { value: 'unknown', count: 20 }],
}

describe('buildHomeSnapshot', () => {
  it('derives budgets, sorted states and missing-data coverage', () => {
    const r = buildHomeSnapshot(good)
    if (r.status !== 'ok') throw new Error('expected ok')
    expect(r.snapshot.budgets).toEqual([{ lo: 45000, hi: 50000, count: 40 }])
    expect(r.snapshot.states.map((s) => s.value)).toEqual(['TX', 'MO'])
    expect(r.snapshot.missing).toEqual({ state: 60, entryType: 50, price: 60 })
    expect(r.snapshot.entryTypes).toEqual([{ value: 'side_entry', count: 50 }])
  })

  it('hides missing-data coverage when facet counts exceed the total', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = buildHomeSnapshot({ ...good, total: 5 })
    expect(r.status === 'ok' && r.snapshot.missing).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('is unavailable without a calculation time (stale cache or outage fallback)', () => {
    expect(buildHomeSnapshot({ ...good, calculatedAt: undefined }).status).toBe('unavailable')
    expect(buildHomeSnapshot({ total: 0, stateBreakdown: [] }).status).toBe('unavailable')
    expect(buildHomeSnapshot(undefined).status).toBe('unavailable')
  })
})

describe('fetchHomeSnapshot', () => {
  it('is unavailable on non-OK and thrown fetches', async () => {
    expect((await fetchHomeSnapshot('http://api', vi.fn(async () => ({ ok: false }) as Response))).status).toBe('unavailable')
    expect((await fetchHomeSnapshot('http://api', vi.fn(async () => { throw new Error('x') }))).status).toBe('unavailable')
  })
  it('reads the facets endpoint', async () => {
    const f = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ data: good }) }) as Response)
    expect((await fetchHomeSnapshot('http://api', f)).status).toBe('ok')
    expect(f.mock.calls[0]?.[0]).toBe('http://api/v1/listings/facets')
  })
})
