'use client'

import { useEffect, useRef } from 'react'

/**
 * Remembers what had focus when the inspector opened and puts focus back on
 * it when it closes. If that element is gone (the list re-rendered), focus
 * falls back to `fallbackId`, so keyboard users never get dropped to <body>.
 * Only the closed → open transition records an opener; moving between
 * selections while open keeps the original one.
 */
export function useFocusReturn(open: boolean, fallbackId: string): void {
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)

  if (open && !wasOpen.current) {
    const active = typeof document === 'undefined' ? null : document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
  }
  wasOpen.current = open

  useEffect(() => {
    if (open) return undefined
    const target = opener.current
    if (!target) return undefined
    opener.current = null
    const restore = target.isConnected ? target : document.getElementById(fallbackId)
    restore?.focus()
    return undefined
  }, [open, fallbackId])
}
