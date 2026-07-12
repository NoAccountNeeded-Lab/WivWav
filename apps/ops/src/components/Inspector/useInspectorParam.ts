'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export interface InspectorParamState {
  /** The param's current value, or `null` when the inspector is closed. */
  value: string | null
  isOpen: boolean
  /** Sets the param, opening the inspector. Adds a history entry so the
   *  browser back button closes the inspector before leaving the route. */
  open: (nextValue: string) => void
  /** Clears the param, closing the inspector. Replaces the current history
   *  entry so dismissing never adds an entry or reloads the page. */
  close: () => void
}

/**
 * Reads and writes a single URL search param that drives inspector
 * open/close state (E6/D4/R1: Stripe-style deep-linkable inspectors). The
 * same state renders identically after a full reload since it lives in the
 * URL, not component state.
 */
export function useInspectorParam(paramName: string): InspectorParamState {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const value = searchParams.get(paramName)

  const open = useCallback(
    (nextValue: string) => {
      const next = new URLSearchParams(searchParams.toString())
      next.set(paramName, nextValue)
      router.push(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [paramName, pathname, router, searchParams],
  )

  const close = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete(paramName)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [paramName, pathname, router, searchParams])

  return { value, isOpen: value !== null, open, close }
}
