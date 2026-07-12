// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePolledResource } from './use-polled-resource'
import { clearWarmCache, setWarmCacheEntry } from './warm-data-cache'

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

  it('should re-fetch immediately when retry is called', async () => {
    const fetcher = vi.fn(async () => ({ data: { count: 1 } }))
    const { result } = renderHook(() => usePolledResource('key-e', fetcher, 30_000))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    await act(async () => {
      await result.current.retry()
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
