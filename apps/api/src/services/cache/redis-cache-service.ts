import type { Redis } from 'ioredis'
import type { CacheService } from './types.js'

/**
 * Production CacheService implementation backed by ioredis.
 *
 * Handles lazy connection (`lazyConnect: true`) by calling `connect()` inside
 * `ping()` when the underlying client is in the `wait` state, matching the
 * pattern previously used directly in the health and metrics routes.
 */
export class RedisCacheService implements CacheService {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key)
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.redis.set(key, value, 'EX', ttlSeconds)
    } else {
      await this.redis.set(key, value)
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key)
  }

  async ping(): Promise<void> {
    if (this.redis.status === 'wait') {
      await this.redis.connect()
    }
    await this.redis.ping()
  }

  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get(key).catch(() => null)
    if (cached !== null) return JSON.parse(cached) as T

    const value = await factory()
    await this.set(key, JSON.stringify(value), ttlSeconds).catch(() => {})
    return value
  }

  /** Expose the underlying ioredis client for graceful shutdown in index.ts. */
  get client(): Redis {
    return this.redis
  }
}
