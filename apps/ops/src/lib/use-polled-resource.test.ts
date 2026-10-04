// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePolledResource } from './use-polled-resource'
import { clearWarmCache, getWarmCacheEntry, setWarmCacheEntry } from './warm-data-cache'

afterEach(() => {
  clearWarmCache()
  vi.restoreAllMocks()
})

describe('usePolledResource', () => {
  it('should start loading with no data when the cache is empty', () => {
    const fetcher = vi.fn(async () => new Promise<{ data: string | null }>(() => { /* never resolves */ }))
    const { result } = renderHook(() => usePolledResource('key-a', fetcher, 30_000))
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(true)
  })

  it('should render a cached value immediately while revalidating in the background', async () => {
    setWarmCacheEntry('key-b', { name: 'cached' })
    const fetcher = vi.fn(async () => new Promise<{ data: { name: string } | null }>(() => { /* pending */ }))
    const { result } = renderHook(() => usePolledResource('key-b', fetcher, 30_000))

    expect(result.current.data).toEqual({ name: 'cached' })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isRefreshing).toBe(true)
  })

  it('should update data and clear isLoading once the first fetch resolves', async () => {
    const fetcher = vi.fn(async () => ({ data: { name: 'fresh' } }))
    const { result } = renderHook(() => usePolledResource('key-c', fetcher, 30_000))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual({ name: 'fresh' })
    expect(result.current.error).toBeNull()
  })

  it('should surface an error without discarding previously loaded data', async () => {
    let call = 0
    const fetcher = vi.fn(async () => {
      call += 1
      if (call === 1) return { data: { name: 'first' } }
      return { data: null, error: 'boom' }
    })
    const { result } = renderHook(() => usePolledResource('key-d', fetcher, 30_000))

    await waitFor(() => expect(result.current.data).toEqual({ name: 'first' }))

    await act(async () => {
      await result.current.retry()
    })

    expect(result.current.error).toBe('boom')
    expect(result.current.data).toEqual({ name: 'first' })
  })

  it('stamps requestStartedAt at request start, so a slow old response is not fresher than a later reference time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T10:00:00Z'))
    let release: (value: { data: string }) => void = () => {}
    const fetcher = vi.fn(() => new Promise<{ data: string }>(resolve => { release = resolve }))
    const { result } = renderHook(() => usePolledResource('req-start', fetcher, 600_000))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const reference = Date.parse('2026-10-04T10:00:30Z')
    vi.setSystemTime(new Date('2026-10-04T10:01:00Z'))
    await act(async () => { release({ data: 'old' }) })

    expect(result.current.data).toBe('old')
    expect(result.current.updatedAt?.getTime()).toBeGreaterThan(reference)
    expect(result.current.requestStartedAt?.getTime()).toBe(Date.parse('2026-10-04T10:00:00Z'))
    expect(result.current.requestStartedAt!.getTime()).toBeLessThan(reference)
    vi.useRealTimers()
  })

  it('retains requestStartedAt of the last success on failure and resets it per key', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ data: 'good' })
      .mockResolvedValue({ data: null, error: 'boom' })
    const { result, rerender } = renderHook(({ k }) => usePolledResource(k, fetcher, 600_000), { initialProps: { k: 'req-a' } })
    await waitFor(() => expect(result.current.data).toBe('good'))
    const started = result.current.requestStartedAt
    expect(started).not.toBeNull()

    await act(async () => { await result.current.retry() })
    expect(result.current.error).toBe('boom')
    expect(result.current.requestStartedAt).toBe(started)

    rerender({ k: 'req-b' })
    expect(result.current.requestStartedAt).toBeNull()
  })

  it('should re-fetch immediately when retry is called', async () => {
    const fetcher = vi.fn(async () => ({ data: { count: 1 } }))
    const { result } = renderHook(() => usePolledResource('key-e', fetcher, 30_000))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    await act(async () => {
      await result.current.retry()
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  describe('guarded polling options', () => {
    function setVisibility(state: 'visible' | 'hidden') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    afterEach(() => {
      vi.useRealTimers()
      setVisibility('visible')
    })

    it('should keep the legacy behaviour of polling while hidden and overlapping when no options are given', async () => {
      vi.useFakeTimers()
      setVisibility('hidden')
      const fetcher = vi.fn(async () => new Promise<{ data: string | null }>(() => { /* never settles */ }))
      renderHook(() => usePolledResource('guard-legacy', fetcher, 1_000))

      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })

      expect(fetcher).toHaveBeenCalledTimes(4)
    })

    it('should not start a new load while the previous one is still in flight', async () => {
      vi.useFakeTimers()
      let release: (value: { data: string }) => void = () => undefined
      const fetcher = vi.fn(() => new Promise<{ data: string }>(resolve => { release = resolve }))
      const { result } = renderHook(() => usePolledResource('guard-overlap', fetcher, 1_000, { preventOverlap: true }))

      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      await act(async () => { await result.current.retry() })
      expect(fetcher).toHaveBeenCalledTimes(1)

      await act(async () => { release({ data: 'done' }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('should turn a first-load fetcher rejection into an error and settle loading flags', async () => {
      vi.useFakeTimers()
      const fetcher = vi.fn().mockRejectedValue(new Error('network down'))
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)
      const { result } = renderHook(() => usePolledResource('guard-throw-first', fetcher, 1_000, { preventOverlap: true }))

      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      process.off('unhandledRejection', unhandled)

      expect(result.current.error).toBe('network down')
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isRefreshing).toBe(false)
      expect(result.current.data).toBeNull()
      expect(unhandled).not.toHaveBeenCalled()
    })

    it('should release the in-flight guard and keep stale data when a later fetcher throws', async () => {
      vi.useFakeTimers()
      const fetcher = vi.fn()
        .mockResolvedValueOnce({ data: 'good' })
        .mockRejectedValueOnce('plain string')
        .mockResolvedValue({ data: 'later' })
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)
      const { result } = renderHook(() => usePolledResource('guard-throw-later', fetcher, 1_000, { preventOverlap: true }))

      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(result.current.data).toBe('good')
      expect(result.current.error).toBe('Request failed')
      expect(result.current.isRefreshing).toBe(false)

      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      process.off('unhandledRejection', unhandled)
      expect(fetcher).toHaveBeenCalledTimes(3)
      expect(result.current.data).toBe('later')
      expect(result.current.error).toBeNull()
      expect(unhandled).not.toHaveBeenCalled()
    })

    it('should fetch a new key immediately and ignore the old key completion while its guarded request is pending', async () => {
      vi.useFakeTimers()
      const resolvers: Record<string, (value: { data: string }) => void> = {}
      const fetcher = vi.fn((k: string) => new Promise<{ data: string }>(resolve => { resolvers[k] = resolve }))
      const { result, rerender } = renderHook(
        ({ k }) => usePolledResource(k, () => fetcher(k), 30_000, { preventOverlap: true }),
        { initialProps: { k: 'entity-a' } },
      )
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(fetcher).toHaveBeenCalledTimes(1)

      rerender({ k: 'entity-b' })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(fetcher).toHaveBeenLastCalledWith('entity-b')
      expect(result.current.data).toBeNull()
      expect(result.current.isLoading).toBe(true)

      await act(async () => { resolvers['entity-a']?.({ data: 'A-data' }) })
      expect(result.current.data).toBeNull()
      expect(result.current.isLoading).toBe(true)

      await act(async () => { resolvers['entity-b']?.({ data: 'B-data' }) })
      expect(result.current.data).toBe('B-data')
      expect(result.current.isLoading).toBe(false)
    })

    it('should not let an old key completion release the new key guard', async () => {
      vi.useFakeTimers()
      const resolvers: Record<string, (value: { data: string }) => void> = {}
      const fetcher = vi.fn((k: string) => new Promise<{ data: string }>(resolve => { resolvers[k] = resolve }))
      const { result, rerender } = renderHook(
        ({ k }) => usePolledResource(k, () => fetcher(k), 1_000, { preventOverlap: true }),
        { initialProps: { k: 'guard-a' } },
      )
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      rerender({ k: 'guard-b' })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(fetcher).toHaveBeenCalledTimes(2)

      await act(async () => { resolvers['guard-a']?.({ data: 'A' }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      await act(async () => { await result.current.retry() })
      expect(fetcher).toHaveBeenCalledTimes(2)

      await act(async () => { resolvers['guard-b']?.({ data: 'B' }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(fetcher).toHaveBeenCalledTimes(3)
    })

    it('should still apply the only in-flight load when StrictMode replays the mount effect', async () => {
      let release: (value: { data: string }) => void = () => undefined
      const fetcher = vi.fn(() => new Promise<{ data: string }>(resolve => { release = resolve }))
      const { result } = renderHook(
        () => usePolledResource('guard-strict', fetcher, 30_000, { preventOverlap: true }),
        { wrapper: StrictMode },
      )

      expect(fetcher).toHaveBeenCalledTimes(1)
      await act(async () => { release({ data: 'applied' }) })

      expect(result.current.data).toBe('applied')
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isRefreshing).toBe(false)
    })

    it('should not update state after unmount', async () => {
      let release: (value: { data: string }) => void = () => undefined
      const fetcher = vi.fn(() => new Promise<{ data: string }>(resolve => { release = resolve }))
      const { unmount } = renderHook(() => usePolledResource('guard-unmount', fetcher, 30_000, { preventOverlap: true }))
      unmount()
      await act(async () => { release({ data: 'late' }) })

      expect(getWarmCacheEntry('guard-unmount')).toBeUndefined()
    })

    it('should skip interval ticks while hidden and refetch immediately when the tab becomes visible', async () => {
      vi.useFakeTimers()
      const fetcher = vi.fn(async () => ({ data: 'tick' }))
      renderHook(() => usePolledResource('guard-visible', fetcher, 1_000, { visibleOnly: true }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(fetcher).toHaveBeenCalledTimes(1)

      setVisibility('hidden')
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(fetcher).toHaveBeenCalledTimes(1)

      setVisibility('visible')
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('should retain the last successful data when a later guarded load fails', async () => {
      vi.useFakeTimers()
      const fetcher = vi.fn()
        .mockResolvedValueOnce({ data: 'good' })
        .mockResolvedValue({ data: null, error: 'API returned 503' })
      const { result } = renderHook(() => usePolledResource('guard-stale', fetcher, 1_000, { visibleOnly: true, preventOverlap: true }))

      await act(async () => { await vi.advanceTimersByTimeAsync(1_100) })

      expect(result.current.data).toBe('good')
      expect(result.current.error).toBe('API returned 503')
      expect(result.current.updatedAt).not.toBeNull()
    })
  })
})
