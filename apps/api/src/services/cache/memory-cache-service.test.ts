import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryCacheService } from './memory-cache-service.js'

describe('MemoryCacheService', () => {
  let svc: MemoryCacheService

  beforeEach(() => {
    svc = new MemoryCacheService()
  })

  describe('get / set', () => {
    it('returns null for a key that has not been set', async () => {
      expect(await svc.get('missing')).toBeNull()
    })

    it('returns the stored value after set', async () => {
      await svc.set('key', 'value')
      expect(await svc.get('key')).toBe('value')
    })

    it('overwrites an existing key', async () => {
      await svc.set('key', 'first')
      await svc.set('key', 'second')
      expect(await svc.get('key')).toBe('second')
    })
  })

  describe('TTL expiry', () => {
    it('returns the value before TTL expires', async () => {
      await svc.set('k', 'v', 60)
      expect(await svc.get('k')).toBe('v')
    })

    it('returns null after TTL expires', async () => {
      vi.useFakeTimers()
      await svc.set('k', 'v', 1)
      vi.advanceTimersByTime(1001)
      expect(await svc.get('k')).toBeNull()
      vi.useRealTimers()
    })

    it('stores without expiry when ttlSeconds is omitted', async () => {
      vi.useFakeTimers()
      await svc.set('k', 'v')
      vi.advanceTimersByTime(999_999)
      expect(await svc.get('k')).toBe('v')
      vi.useRealTimers()
    })
  })

  describe('del', () => {
    it('removes an existing key', async () => {
      await svc.set('key', 'value')
      await svc.del('key')
      expect(await svc.get('key')).toBeNull()
    })

    it('does not throw when deleting a non-existent key', async () => {
      await expect(svc.del('never-set')).resolves.toBeUndefined()
    })
  })

  describe('ping', () => {
    it('resolves without throwing', async () => {
      await expect(svc.ping()).resolves.toBeUndefined()
    })
  })

  describe('getOrSet', () => {
    it('calls factory on cache miss and caches the result', async () => {
      const factory = vi.fn(async () => ({ result: 42 }))
      const result = await svc.getOrSet('key', factory, 60)
      expect(factory).toHaveBeenCalledOnce()
      expect(result).toEqual({ result: 42 })
    })

    it('returns cached value without calling factory on cache hit', async () => {
      const factory = vi.fn(async () => ({ result: 42 }))
      await svc.set('key', JSON.stringify({ result: 42 }))
      const result = await svc.getOrSet('key', factory, 60)
      expect(factory).not.toHaveBeenCalled()
      expect(result).toEqual({ result: 42 })
    })

    it('calls factory again after TTL expires', async () => {
      vi.useFakeTimers()
      const factory = vi.fn(async () => ({ result: 1 }))
      await svc.getOrSet('key', factory, 1)
      expect(factory).toHaveBeenCalledOnce()

      vi.advanceTimersByTime(1001)

      factory.mockResolvedValueOnce({ result: 2 })
      const result = await svc.getOrSet('key', factory, 1)
      expect(factory).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ result: 2 })
      vi.useRealTimers()
    })
  })

  describe('clear', () => {
    it('removes all stored entries', async () => {
      await svc.set('a', '1')
      await svc.set('b', '2')
      svc.clear()
      expect(await svc.get('a')).toBeNull()
      expect(await svc.get('b')).toBeNull()
    })
  })
})
