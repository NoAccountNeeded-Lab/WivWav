/**
 * Backend-agnostic cache interface.
 *
 * Callers never import ioredis directly — they depend on this interface instead.
 * Concrete implementations:
 *   - RedisCacheService  — wraps ioredis; used in production
 *   - MemoryCacheService — in-process Map; used in unit tests and local dev
 */
export interface CacheService {
  /** Return the cached string value for `key`, or null if absent / on error. */
  get(key: string): Promise<string | null>

  /**
   * Store `value` under `key`.
   * When `ttlSeconds` is provided the entry expires after that many seconds.
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>

  /** Remove the entry for `key`. */
  del(key: string): Promise<void>

  /**
   * Send a lightweight health ping to the underlying store.
   * Throws on failure; implementations may reconnect lazily before pinging.
   */
  ping(): Promise<void>

  /**
   * Cache-aside helper — return the cached value for `key` if present;
   * otherwise call `factory`, cache the result for `ttlSeconds`, and return it.
   */
  getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T>
}
