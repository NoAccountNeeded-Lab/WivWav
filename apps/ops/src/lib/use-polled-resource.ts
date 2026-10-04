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

export interface PolledResourceOptions {
  /** Skip interval ticks while the tab is hidden and refetch as soon as it is visible again. */
  visibleOnly?: boolean
  /** Drop a load (interval tick, retry, or visibility refetch) while a previous one is still in flight. */
  preventOverlap?: boolean
}

interface KeyedState<T> {
  key: string
  data: T | null
  error: string | null
  isLoading: boolean
  isRefreshing: boolean
  updatedAt: Date | null
}

function initialState<T>(key: string): KeyedState<T> {
  const cached = getWarmCacheEntry<T>(key)
  return {
    key,
    data: cached?.data ?? null,
    error: null,
    isLoading: cached === undefined,
    isRefreshing: false,
    updatedAt: cached?.updatedAt ?? null,
  }
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
  options: PolledResourceOptions = {},
): PolledResourceState<T> {
  // All per-resource state is tagged with the key it belongs to, so a key
  // change never exposes the previous entity's data or loading flags.
  const [state, setState] = useState<KeyedState<T>>(() => initialState<T>(key))
  if (state.key !== key) setState(initialState<T>(key))
  const current = state.key === key ? state : initialState<T>(key)

  // Fetcher identity is expected to change across renders (it closes over
  // apiBaseUrl etc.), so it's tracked in a ref rather than an effect dep to
  // avoid tearing down/restarting the polling interval on every render.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // Same ref pattern as the fetcher: the options bag is usually an inline
  // object literal and must not restart the interval when it changes identity.
  const optionsRef = useRef(options)
  optionsRef.current = options
  // Tracks the key being rendered and whether the component is mounted, so
  // completions that arrive for a superseded key or after unmount are dropped.
  // Effect cleanup does not invalidate in-flight loads: the StrictMode mount
  // replay would otherwise orphan the only request while the overlap guard
  // skipped its replacement.
  const keyRef = useRef(key)
  keyRef.current = key
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // One token per in-flight load; the overlap guard only blocks a load for the same key.
  const inFlightRef = useRef<{ key: string } | null>(null)

  const patch = useCallback((loadKey: string, changes: Partial<Omit<KeyedState<T>, 'key'>>) => {
    setState(prev => (prev.key === loadKey ? { ...prev, ...changes } : prev))
  }, [])

  const load = useCallback(async () => {
    if (optionsRef.current.preventOverlap && inFlightRef.current?.key === key) return
    const token = { key }
    inFlightRef.current = token
    patch(key, { isRefreshing: true })
    let result: { data: T | null; error?: string }
    try {
      result = await fetcherRef.current()
    } catch (err) {
      result = { data: null, error: err instanceof Error ? err.message : 'Request failed' }
    } finally {
      if (inFlightRef.current === token) inFlightRef.current = null
    }
    if (!mountedRef.current || keyRef.current !== key) return
    if (result.data !== null) {
      setWarmCacheEntry(key, result.data)
      patch(key, { data: result.data, error: null, updatedAt: new Date(), isLoading: false, isRefreshing: false })
    } else {
      patch(key, { ...(result.error ? { error: result.error } : {}), isLoading: false, isRefreshing: false })
    }
  }, [key, patch])

  const setData = useCallback<Dispatch<SetStateAction<T | null>>>(
    action => {
      setState(prev => {
        if (prev.key !== keyRef.current) return prev
        const next = typeof action === 'function' ? (action as (p: T | null) => T | null)(prev.data) : action
        return { ...prev, data: next }
      })
    },
    [],
  )

  useEffect(() => {
    void load()
    const isHidden = () => optionsRef.current.visibleOnly === true && document.visibilityState === 'hidden'
    const id = window.setInterval(() => {
      if (!isHidden()) void load()
    }, intervalMs)
    const onVisibilityChange = () => {
      if (optionsRef.current.visibleOnly && document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [load, intervalMs])

  return {
    data: current.data,
    error: current.error,
    isLoading: current.isLoading,
    isRefreshing: current.isRefreshing,
    updatedAt: current.updatedAt,
    retry: load,
    setData,
  }
}
