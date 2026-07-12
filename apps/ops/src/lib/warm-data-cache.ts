/**
 * Module-level "warm data" cache (E5, issue #732).
 *
 * Holds the last-known value fetched for each route/endpoint key so a route
 * revisited within the same browser session can render immediately with
 * stale-but-present data instead of a blank/skeleton state, while a fresh
 * fetch revalidates it in the background.
 *
 * Lives only in module memory: it survives client-side navigation (the
 * module stays loaded for the life of the tab) but resets on a full page
 * reload, which is the desired "same session" scope.
 */

interface CacheEntry<T> {
  data: T
  updatedAt: Date
}

const cache = new Map<string, CacheEntry<unknown>>()

export function getWarmCacheEntry<T>(key: string): CacheEntry<T> | undefined {
  return cache.get(key) as CacheEntry<T> | undefined
}

export function setWarmCacheEntry<T>(key: string, data: T): CacheEntry<T> {
  const entry: CacheEntry<T> = { data, updatedAt: new Date() }
  cache.set(key, entry)
  return entry
}

/** Test-only: reset all cached entries between test cases. */
export function clearWarmCache(): void {
  cache.clear()
}
