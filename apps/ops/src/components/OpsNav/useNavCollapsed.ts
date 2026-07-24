'use client'

import { useCallback, useState } from 'react'

const STORAGE_KEY = 'ops-nav-collapsed'

function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    // localStorage unavailable (private mode, disabled, storage quota) — fall
    // back to expanded rather than throwing during render.
    return false
  }
}

/**
 * Persists the desktop `NavColumn`'s collapsed/expanded state (#911) in
 * `localStorage`. The stored value is read synchronously in the `useState`
 * initializer — not in an effect — so the very first client render already
 * reflects the persisted choice instead of rendering expanded and then
 * flashing to collapsed (or vice versa) once an effect runs after mount.
 */
export function useNavCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed)

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
