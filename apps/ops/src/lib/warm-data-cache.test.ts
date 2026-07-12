import { afterEach, describe, expect, it } from 'vitest'
import { clearWarmCache, getWarmCacheEntry, setWarmCacheEntry } from './warm-data-cache'

afterEach(() => {
  clearWarmCache()
})

describe('warm-data-cache', () => {
  it('should return undefined for a key that has never been set', () => {
    expect(getWarmCacheEntry('missing')).toBeUndefined()
  })

  it('should return the stored value and a timestamp after setting a key', () => {
    const before = Date.now()
    const entry = setWarmCacheEntry('health', { status: 'ok' })
    expect(getWarmCacheEntry('health')).toEqual(entry)
    expect(entry.data).toEqual({ status: 'ok' })
    expect(entry.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('should overwrite a previous value for the same key', () => {
    setWarmCacheEntry('queues', [{ name: 'a' }])
    setWarmCacheEntry('queues', [{ name: 'b' }])
    expect(getWarmCacheEntry('queues')?.data).toEqual([{ name: 'b' }])
  })

  it('should keep separate keys independent', () => {
    setWarmCacheEntry('a', 1)
    setWarmCacheEntry('b', 2)
    expect(getWarmCacheEntry('a')?.data).toBe(1)
    expect(getWarmCacheEntry('b')?.data).toBe(2)
  })

  it('should clear all entries', () => {
    setWarmCacheEntry('a', 1)
    clearWarmCache()
    expect(getWarmCacheEntry('a')).toBeUndefined()
  })
})
