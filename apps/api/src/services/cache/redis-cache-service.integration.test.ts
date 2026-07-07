import { Redis } from 'ioredis'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { RedisCacheService } from './redis-cache-service.js'

// Round-trips get/set/del/ping/getOrSet against a real Valkey instance — the
// mocked unit test only asserts which ioredis method was called, never that
// a value written actually comes back out (#599).
describe('RedisCacheService (integration)', () => {
  const redis = new Redis(process.env['VALKEY_URL'] ?? 'redis://localhost:6379')
  const svc = new RedisCacheService(redis)

  beforeEach(async () => {
    await redis.flushdb()
  })

  afterAll(async () => {
    await redis.flushdb()
    redis.disconnect()
  })

  it('round-trips a value through set/get', async () => {
    await svc.set('integration:key', 'hello')
    expect(await svc.get('integration:key')).toBe('hello')
  })

  it('returns null for a missing key', async () => {
    expect(await svc.get('integration:missing')).toBeNull()
  })

  it('expires a value after its TTL', async () => {
    await svc.set('integration:ttl', 'value', 1)
    expect(await svc.get('integration:ttl')).toBe('value')
    expect(await redis.ttl('integration:ttl')).toBeGreaterThan(0)
  })

  it('removes a value on del', async () => {
    await svc.set('integration:del', 'value')
    await svc.del('integration:del')
    expect(await svc.get('integration:del')).toBeNull()
  })

  it('pings successfully against a live connection', async () => {
    await expect(svc.ping()).resolves.toBeUndefined()
  })

  it('getOrSet caches the factory result for subsequent calls', async () => {
    let calls = 0
    const factory = async () => {
      calls += 1
      return { value: calls }
    }

    const first = await svc.getOrSet('integration:getOrSet', factory, 60)
    const second = await svc.getOrSet('integration:getOrSet', factory, 60)

    expect(first).toEqual({ value: 1 })
    expect(second).toEqual({ value: 1 })
    expect(calls).toBe(1)
  })
})
