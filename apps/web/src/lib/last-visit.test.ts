import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// last-visit.ts calls localStorage directly.  We provide a minimal Map-backed
// implementation via vi.stubGlobal so the tests run in Node without jsdom.
// The real browser behaviour (security errors, storage full) is covered by
// the error-path tests that swap the spy with a throwing implementation.

let store: Map<string, string>

function makeLocalStorage(): Storage {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
  }
}

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', makeLocalStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Import after stubbing so the module sees the stubbed global at call time.
const { getLastVisitTimestamp, recordCurrentVisit } = await import('./last-visit.js')

describe('getLastVisitTimestamp', () => {
  it('should return null when no timestamp has been recorded', () => {
    expect(getLastVisitTimestamp()).toBeNull()
  })

  it('should return the stored ISO timestamp after recordCurrentVisit', () => {
    recordCurrentVisit()
    const ts = getLastVisitTimestamp()
    expect(ts).not.toBeNull()
    // Valid ISO string round-trips through Date
    expect(new Date(ts!).toISOString()).toBe(ts)
  })

  it('should return null when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      ...makeLocalStorage(),
      getItem: () => { throw new Error('storage blocked') },
    })
    expect(getLastVisitTimestamp()).toBeNull()
  })
})

describe('recordCurrentVisit', () => {
  it('should store a current-time ISO timestamp', () => {
    const before = Date.now()
    recordCurrentVisit()
    const after = Date.now()
    const stored = localStorage.getItem('wav-last-visit')
    expect(stored).not.toBeNull()
    const t = new Date(stored!).getTime()
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(after)
  })

  it('should overwrite a previous timestamp', () => {
    localStorage.setItem('wav-last-visit', '2020-01-01T00:00:00.000Z')
    recordCurrentVisit()
    const stored = localStorage.getItem('wav-last-visit')
    expect(stored).not.toBe('2020-01-01T00:00:00.000Z')
    expect(new Date(stored!).getFullYear()).toBeGreaterThan(2020)
  })

  it('should silently ignore localStorage errors', () => {
    vi.stubGlobal('localStorage', {
      ...makeLocalStorage(),
      setItem: () => { throw new Error('storage full') },
    })
    expect(() => recordCurrentVisit()).not.toThrow()
  })
})
