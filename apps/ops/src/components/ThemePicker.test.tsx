// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemePicker } from './ThemePicker'

// Mirrors the SSR default in app/layout.tsx (data-theme="grafana"). Keeping
// this in sync is what prevents a first-paint theme flash: if the SSR markup
// and ThemePicker's DEFAULT_DARK_FAMILY ever drift apart, this test catches it.
const SSR_DEFAULT_THEME = 'grafana'

function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
}

// jsdom's built-in Storage is unavailable for the opaque test origin here, so
// stub a minimal in-memory implementation for both global access patterns.
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

describe('ThemePicker SSR-correction behavior (#762)', () => {
  beforeEach(() => {
    const memoryStorage = makeMemoryStorage()
    vi.stubGlobal('localStorage', memoryStorage)
    Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true })
    document.documentElement.dataset.theme = SSR_DEFAULT_THEME
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps the SSR default theme on first visit when the OS prefers dark (no flash)', () => {
    stubMatchMedia(true)

    act(() => {
      render(<ThemePicker />)
    })

    expect(document.documentElement.dataset.theme).toBe(SSR_DEFAULT_THEME)
  })

  it('preserves a previously stored user theme choice instead of the SSR default', () => {
    stubMatchMedia(true)
    localStorage.setItem('ops-theme', 'nord-light')
    localStorage.setItem('ops-mode', 'light')

    act(() => {
      render(<ThemePicker />)
    })

    expect(document.documentElement.dataset.theme).toBe('nord-light')
  })
})
