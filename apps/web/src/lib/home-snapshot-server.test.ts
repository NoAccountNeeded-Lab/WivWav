import { describe, expect, it, vi } from 'vitest'
import { createHomeSnapshotLoader } from './home-snapshot-server'

const ok = { total: 3, calculatedAt: '2026-10-31T08:00:00.000Z', stateBreakdown: [{ value: 'MO', count: 3 }] }

// Minimal stand-in for unstable_cache: memoizes successful results per args, like Next's data cache.
const memoCache = ((fn: (...a: string[]) => Promise<unknown>) => {
  const store = new Map<string, unknown>()
  return async (...args: string[]) => {
    const k = JSON.stringify(args)
    if (!store.has(k)) store.set(k, await fn(...args))
    return store.get(k)
  }
}) as never

describe('createHomeSnapshotLoader', () => {
  it('shares one fetch between calls', async () => {
    const fetcher = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ data: ok }) }) as Response)
    const load = createHomeSnapshotLoader(memoCache, fetcher)
    expect((await load('http://api')).status).toBe('ok')
    expect((await load('http://api')).status).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not cache an unavailable result', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ok }) } as Response)
    const load = createHomeSnapshotLoader(memoCache, fetcher)
    expect((await load('http://api')).status).toBe('unavailable')
    expect((await load('http://api')).status).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
