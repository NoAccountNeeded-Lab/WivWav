'use client'

import { useEffect, useRef } from 'react'

/**
 * Remembers what had focus when the inspector opened and puts focus back on
 * it when it closes. If that element is gone (the list re-rendered) or there
 * never was one (the inspector was already open on page load from a shared
 * URL), focus falls back to `fallbackId`, so keyboard users never get dropped
 * to <body>. Only the closed -> open transition records an opener; moving
 * between selections while open keeps the original one, and an inspector
 * that is open on first render never takes focus from the page.
 */
export function useFocusReturn(open: boolean, fallbackId: string): void {
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)

  if (open && !wasOpen.current) {
    const active = typeof document === 'undefined' ? null : document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
  }

  useEffect(() => {
    if (open) {
      wasOpen.current = true
      return undefined
    }
    if (!wasOpen.current) return undefined
    wasOpen.current = false
    const target = opener.current
    opener.current = null
    const restore = target?.isConnected ? target : document.getElementById(fallbackId)
    restore?.focus()
    return undefined
  }, [open, fallbackId])
}
