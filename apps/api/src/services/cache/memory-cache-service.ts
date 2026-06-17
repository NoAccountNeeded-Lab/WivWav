import type { CacheService } from './types.js'

interface CacheEntry {
  value: string
  expiresAt: number | null
}

/**
 * In-process CacheService implementation backed by a Map.
 *
 * Intended for unit tests and local development without a running Redis instance.
 * TTL expiry is evaluated lazily on each `get` call.
 */
export class MemoryCacheService implements CacheService {
  private readonly store = new Map<string, CacheEntry>()

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key)
    if (!entry) return null

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }

    return entry.value
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null,
    })
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }

  async ping(): Promise<void> {
    // Always healthy for in-process storage
  }

  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get(key)
    if (cached !== null) return JSON.parse(cached) as T

    const value = await factory()
    await this.set(key, JSON.stringify(value), ttlSeconds)
    return value
  }

  /** Remove all entries — useful for clearing state between tests. */
  clear(): void {
    this.store.clear()
  }
}
