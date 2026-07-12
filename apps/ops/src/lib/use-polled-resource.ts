'use client'

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getWarmCacheEntry, setWarmCacheEntry } from './warm-data-cache'

export interface PolledResourceState<T> {
  /** Current value — last-successful fetch, warm-cached value, or null before either has happened. */
  data: T | null
  /** Error from the most recent fetch attempt. Cleared as soon as a fetch succeeds. */
  error: string | null
  /** True only until the first fetch attempt (success or failure) resolves and no cached value exists. */
  isLoading: boolean
  /** True while a fetch is in flight, including background revalidation of cached data. */
  isRefreshing: boolean
  updatedAt: Date | null
  /** Re-fetches immediately, independent of the polling interval. */
  retry: () => void
  /** Escape hatch for callers that need optimistic local mutation (e.g. after a POST action). */
  setData: Dispatch<SetStateAction<T | null>>
}

/**
 * Fetches a single resource on mount, polls it on an interval, and exposes
 * independent loading/error/refreshing state so each caller (e.g. one
 * section of a dashboard) can render as soon as its own data resolves
 * without waiting on sibling resources (E5, issue #732).
 *
 * Warm-data cache (stale-while-revalidate): if a prior fetch for this `key`
 * populated the module-level warm cache, the resource starts with that
 * value instead of null so a route revisited in the same session renders
 * last-known data immediately while a fresh fetch revalidates it.
 */
export function usePolledResource<T>(
  key: string,
  fetcher: () => Promise<{ data: T | null; error?: string }>,
  intervalMs: number,
): PolledResourceState<T> {
  const cached = getWarmCacheEntry<T>(key)
  const [data, setData] = useState<T | null>(cached?.data ?? null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(cached === undefined)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(cached?.updatedAt ?? null)

  // Fetcher identity is expected to change across renders (it closes over
  // apiBaseUrl etc.), so it's tracked in a ref rather than an effect dep to
  // avoid tearing down/restarting the polling interval on every render.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(async () => {
    setIsRefreshing(true)
    const result = await fetcherRef.current()
    if (result.data !== null) {
      setData(result.data)
      setWarmCacheEntry(key, result.data)
      setError(null)
      setUpdatedAt(new Date())
    } else if (result.error) {
      setError(result.error)
    }
    setIsLoading(false)
    setIsRefreshing(false)
  }, [key])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), intervalMs)
    return () => window.clearInterval(id)
  }, [load, intervalMs])

  return { data, error, isLoading, isRefreshing, updatedAt, retry: load, setData }
}
