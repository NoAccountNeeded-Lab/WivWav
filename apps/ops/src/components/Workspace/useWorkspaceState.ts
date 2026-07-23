'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { decodeWorkspaceState, encodeWorkspaceState } from './workspace-url'
import { DEFAULT_PANEL_SPAN, makePanelId } from './workspace-types'
import type { PanelId, PanelSpan, WorkspacePanelState, WorkspaceState } from './workspace-types'

export interface WorkspaceApi {
  panels: WorkspacePanelState[]
  maximizedId: PanelId | null
  isOpen: (id: PanelId) => boolean
  /** Opens `entityType`/`entityId`'s panel, or focuses it if already open —
   *  never duplicates. Returns the panel's id so the caller can pass it to
   *  `focusTarget` consumers. */
  openPanel: (entityType: string, entityId: string, options?: { span?: PanelSpan }) => PanelId
  closePanel: (id: PanelId) => void
  setSpan: (id: PanelId, span: PanelSpan) => void
  maximize: (id: PanelId) => void
  /** Restores the previous (non-maximized) layout. */
  restore: () => void
  /** The panel that most recently became the interaction target — set by
   *  `openPanel` (new or already-open) and by `maximize`/`restore`. Not part
   *  of URL state (it's a one-shot instruction, not durable layout), unlike
   *  everything else this hook exposes. Consume with `consumeFocusTarget`
   *  once handled so the same target doesn't re-trigger a focus move on an
   *  unrelated re-render. */
  focusTarget: PanelId | null
  consumeFocusTarget: () => void
}

/**
 * URL-backed workspace state (#854, decision record section 3): the open
 * panel set, order, spans, and maximized state all live in the `panels`/`max`
 * query params (see `workspace-url.ts`), so a deep link reproduces the exact
 * workspace on reload or share — the same principle `useInspectorParam`
 * established for a single panel, extended to an ordered set.
 */
export function useWorkspaceState(): WorkspaceApi {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [focusTarget, setFocusTarget] = useState<PanelId | null>(null)

  const state = useMemo<WorkspaceState>(() => decodeWorkspaceState(searchParams), [searchParams])

  const commit = useCallback(
    (next: WorkspaceState, options: { addHistoryEntry: boolean } = { addHistoryEntry: true }) => {
      const query = encodeWorkspaceState(next, searchParams).toString()
      const url = query ? `${pathname}?${query}` : pathname
      if (options.addHistoryEntry) {
        router.push(url, { scroll: false })
      } else {
        router.replace(url, { scroll: false })
      }
    },
    [pathname, router, searchParams],
  )

  const isOpen = useCallback((id: PanelId) => state.panels.some(p => p.id === id), [state.panels])

  const openPanel = useCallback(
    (entityType: string, entityId: string, options?: { span?: PanelSpan }) => {
      const id = makePanelId(entityType, entityId)
      const existing = state.panels.find(p => p.id === id)
      if (!existing) {
        const panel: WorkspacePanelState = { id, entityType, entityId, span: options?.span ?? DEFAULT_PANEL_SPAN }
        commit({ panels: [...state.panels, panel], maximizedId: state.maximizedId })
      }
      // Opening an already-open panel focuses it rather than duplicating it —
      // no URL change needed, just the focus signal below.
      setFocusTarget(id)
      return id
    },
    [commit, state.maximizedId, state.panels],
  )

  const closePanel = useCallback(
    (id: PanelId) => {
      const panels = state.panels.filter(p => p.id !== id)
      const maximizedId = state.maximizedId === id ? null : state.maximizedId
      commit({ panels, maximizedId }, { addHistoryEntry: false })
    },
    [commit, state.maximizedId, state.panels],
  )

  const setSpan = useCallback(
    (id: PanelId, span: PanelSpan) => {
      const panels = state.panels.map(p => (p.id === id ? { ...p, span } : p))
      commit({ panels, maximizedId: state.maximizedId }, { addHistoryEntry: false })
    },
    [commit, state.maximizedId, state.panels],
  )

  const maximize = useCallback(
    (id: PanelId) => {
      if (!state.panels.some(p => p.id === id)) return
      commit({ panels: state.panels, maximizedId: id })
      setFocusTarget(id)
    },
    [commit, state.panels],
  )

  const restore = useCallback(() => {
    const previousMaximizedId = state.maximizedId
    commit({ panels: state.panels, maximizedId: null }, { addHistoryEntry: false })
    setFocusTarget(previousMaximizedId)
  }, [commit, state.maximizedId, state.panels])

  const consumeFocusTarget = useCallback(() => setFocusTarget(null), [])

  return {
    panels: state.panels,
    maximizedId: state.maximizedId,
    isOpen,
    openPanel,
    closePanel,
    setSpan,
    maximize,
    restore,
    focusTarget,
    consumeFocusTarget,
  }
}
