'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  buildHelmQuery, clearSelection, focusAncestor, parseHelmLocation, selectLog, selectProblem, selectRun, selectSource,
  type HelmFocusKind, type HelmLocation, type HelmSection,
} from './helm-url'

export interface HelmNavigation {
  location: HelmLocation
  setSection: (section: HelmSection) => void
  openProblem: (fingerprint: string, sourceId: string | null) => void
  openSource: (sourceId: string) => void
  openRun: (runRef: string, sourceId?: string | null) => void
  openLog: (key: string) => void
  focusLevel: (kind: HelmFocusKind) => void
  closeInspector: () => void
  /** The URL that reproduces the current selection, for a "copy link" control. */
  shareHref: string
}

/**
 * URL-backed /helm location. Section changes replace history; selections
 * push, so Back closes the inspector and a copied URL reopens the same
 * problem/source/run/log chain.
 */
export function useHelmLocation(): HelmNavigation {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const queryString = params.toString()
  const location = useMemo(() => parseHelmLocation(new URLSearchParams(queryString)), [queryString])

  const go = useCallback((next: HelmLocation, mode: 'push' | 'replace') => {
    const href = `${pathname}${buildHelmQuery(next)}`
    if (mode === 'push') router.push(href, { scroll: false })
    else router.replace(href, { scroll: false })
  }, [pathname, router])

  const { section, selection } = location
  return {
    location,
    setSection: next => go({ section: next, selection }, 'replace'),
    openProblem: (fingerprint, sourceId) => go({ section, selection: selectProblem(fingerprint, sourceId) }, 'push'),
    openSource: sourceId => go({ section, selection: selectSource(selection, sourceId) }, 'push'),
    openRun: (ref, sourceId) => {
      const withSource = sourceId && selection.source !== sourceId ? selectSource(selection, sourceId) : selection
      go({ section, selection: selectRun(withSource, ref) }, 'push')
    },
    openLog: key => go({ section, selection: selectLog(selection, key) }, 'push'),
    focusLevel: kind => go({ section, selection: focusAncestor(selection, kind) }, 'push'),
    closeInspector: () => go({ section, selection: clearSelection() }, 'push'),
    shareHref: `${pathname}${buildHelmQuery(location)}`,
  }
}
