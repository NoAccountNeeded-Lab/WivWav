'use client'

import { useSyncExternalStore } from 'react'
import { OPS_BREAKPOINTS } from '@/styles/breakpoints'

const QUERY = `(min-width: ${OPS_BREAKPOINTS.xl}px)`

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const list = window.matchMedia(QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

/**
 * True at 1280px and wider. The server snapshot is always `false` (narrow),
 * so hydration matches; the client then switches after mount if the viewport
 * is wide. The inspector chooses one container from this, never both.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
