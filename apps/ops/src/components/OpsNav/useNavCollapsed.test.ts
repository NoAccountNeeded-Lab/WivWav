// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNavCollapsed } from './useNavCollapsed'

const STORAGE_KEY = 'ops-nav-collapsed'

// jsdom's built-in Storage is unavailable for the opaque test origin here
// (mirrors ThemePicker.test.tsx's #762 workaround), so stub a minimal
// in-memory implementation for both global access patterns.
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size },
  } as Storage
}

beforeEach(() => {
  const memoryStorage = makeMemoryStorage()
  vi.stubGlobal('localStorage', memoryStorage)
  Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useNavCollapsed', () => {
  it('starts expanded when nothing is persisted', () => {
    const { result } = renderHook(() => useNavCollapsed())

    expect(result.current[0]).toBe(false)
  })

  it('reads the persisted collapsed state synchronously on mount — no flash after mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')

    const { result } = renderHook(() => useNavCollapsed())

    // Correct on the very first render, not after a subsequent effect.
    expect(result.current[0]).toBe(true)
  })

  it('toggle flips the in-memory state and persists it to localStorage', () => {
    const { result } = renderHook(() => useNavCollapsed())

    act(() => {
      result.current[1]()
    })
    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')

    act(() => {
      result.current[1]()
    })
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false')
  })

  it('a fresh mount picks up the persisted value written by a prior toggle', () => {
    const first = renderHook(() => useNavCollapsed())
    act(() => {
      first.result.current[1]()
    })
    first.unmount()

    const second = renderHook(() => useNavCollapsed())
    expect(second.result.current[0]).toBe(true)
  })
})
