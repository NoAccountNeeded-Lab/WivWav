import { describe, it, expect, vi } from 'vitest'
import { RedisCacheService } from './redis-cache-service.js'

function makeRedis(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready' as string,
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    ping: vi.fn(async () => 'PONG'),
    connect: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('RedisCacheService', () => {
  describe('get', () => {
    it('returns the value from redis', async () => {
      const redis = makeRedis({ get: vi.fn(async () => 'hello') })
      const svc = new RedisCacheService(redis as never)
      expect(await svc.get('k')).toBe('hello')
      expect(redis.get).toHaveBeenCalledWith('k')
    })

    it('returns null when redis returns null', async () => {
      const redis = makeRedis()
      const svc = new RedisCacheService(redis as never)
      expect(await svc.get('missing')).toBeNull()
    })
  })

  describe('set', () => {
    it('calls SET without EX when ttlSeconds is omitted', async () => {
      const redis = makeRedis()
      const svc = new RedisCacheService(redis as never)
      await svc.set('k', 'v')
      expect(redis.set).toHaveBeenCalledWith('k', 'v')
    })

    it('calls SET with EX when ttlSeconds is provided', async () => {
      const redis = makeRedis()
      const svc = new RedisCacheService(redis as never)
      await svc.set('k', 'v', 60)
      expect(redis.set).toHaveBeenCalledWith('k', 'v', 'EX', 60)
    })
  })

  describe('del', () => {
    it('calls DEL on the redis client', async () => {
      const redis = makeRedis()
      const svc = new RedisCacheService(redis as never)
      await svc.del('k')
      expect(redis.del).toHaveBeenCalledWith('k')
    })
  })

  describe('ping', () => {
    it('pings when status is ready', async () => {
      const redis = makeRedis({ status: 'ready' })
      const svc = new RedisCacheService(redis as never)
      await svc.ping()
      expect(redis.connect).not.toHaveBeenCalled()
      expect(redis.ping).toHaveBeenCalledOnce()
    })

    it('connects before pinging when status is wait', async () => {
      const redis = makeRedis({ status: 'wait' })
      const svc = new RedisCacheService(redis as never)
      await svc.ping()
      expect(redis.connect).toHaveBeenCalledOnce()
      expect(redis.ping).toHaveBeenCalledOnce()
    })
  })

  describe('getOrSet', () => {
    it('returns cached value without calling factory on hit', async () => {
      const redis = makeRedis({ get: vi.fn(async () => JSON.stringify({ x: 1 })) })
      const factory = vi.fn()
      const svc = new RedisCacheService(redis as never)
      const result = await svc.getOrSet('k', factory, 60)
      expect(factory).not.toHaveBeenCalled()
      expect(result).toEqual({ x: 1 })
    })

    it('calls factory on cache miss and stores the result', async () => {
      const redis = makeRedis({ get: vi.fn(async () => null) })
      const factory = vi.fn(async () => ({ x: 2 }))
      const svc = new RedisCacheService(redis as never)
      const result = await svc.getOrSet('k', factory, 30)
      expect(factory).toHaveBeenCalledOnce()
      expect(result).toEqual({ x: 2 })
      expect(redis.set).toHaveBeenCalledWith('k', JSON.stringify({ x: 2 }), 'EX', 30)
    })

    it('still returns the factory value even when cache write fails', async () => {
      const redis = makeRedis({
        get: vi.fn(async () => null),
        set: vi.fn(async () => { throw new Error('write failed') }),
      })
      const factory = vi.fn(async () => ({ x: 3 }))
      const svc = new RedisCacheService(redis as never)
      const result = await svc.getOrSet('k', factory)
      expect(result).toEqual({ x: 3 })
    })
  })

  describe('client getter', () => {
    it('exposes the underlying redis instance', () => {
      const redis = makeRedis()
      const svc = new RedisCacheService(redis as never)
      expect(svc.client).toBe(redis)
    })
  })
})
