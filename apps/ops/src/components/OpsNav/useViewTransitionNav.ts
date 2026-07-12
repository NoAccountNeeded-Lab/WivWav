'use client'

import { useRouter } from 'next/navigation'
import type { MouseEvent } from 'react'

/**
 * Cross-route fade for internal nav links (E8/#735), built on the View
 * Transitions API. Strictly progressive enhancement: every early return
 * below falls through to `next/link`'s default navigation, so there is no
 * behavioral difference in browsers without `document.startViewTransition`,
 * under `prefers-reduced-motion: reduce`, or for modified/non-primary clicks
 * (new-tab intents must keep working exactly as they do today).
 */
export function useViewTransitionNav(): (event: MouseEvent<HTMLAnchorElement>, href: string) => void {
  const router = useRouter()

  return (event, href) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') {
      return
    }

    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    event.preventDefault()
    document.startViewTransition(() => {
      router.push(href)
    })
  }
}
