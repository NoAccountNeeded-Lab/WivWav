'use client'

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

const STORAGE_KEY = 'ops-nav-collapsed'

// `NavColumn` is server-rendered (no `dynamic(..., { ssr: false })` in its
// tree), so `useLayoutEffect` must not run during SSR — React warns loudly
// if it does. Falling back to `useEffect` on the server is a no-op there
// either way, since server render never paints.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    // localStorage unavailable (private mode, disabled, storage quota) — fall
    // back to expanded rather than throwing.
    return false
  }
}

/**
 * Persists the desktop `NavColumn`'s collapsed/expanded state (#911) in
 * `localStorage`. The initial state always matches the server-rendered
 * default (expanded) — reading `localStorage` in the `useState` initializer
 * would make the first client render diverge from the SSR markup and trip a
 * React hydration mismatch (the same problem `ThemePicker.tsx` avoids by
 * applying its stored preference after mount rather than during initial
 * render). Instead, the stored value is applied in a layout effect, which
 * commits and repaints before the browser has a chance to show a frame —
 * so a returning user still sees the correct state immediately, without a
 * hydration error.
 */
export function useNavCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false)

  useIsomorphicLayoutEffect(() => {
    const stored = readStoredCollapsed()
    if (stored) {
      setCollapsed(true)
    }
  }, [])

  const toggle = useCallback(() => {
    setCollapsed(previous => {
      const next = !previous
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // Persistence is best-effort; the toggle still works in-memory.
      }
      return next
    })
  }, [])

  return [collapsed, toggle]
}
