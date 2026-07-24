'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { decodeWorkspaceState, encodeWorkspaceState } from './workspace-url'
import { DEFAULT_PANEL_SPAN, makePanelId } from './workspace-types'
import type { PanelId, PanelSpan, WorkspacePanelState, WorkspaceState } from './workspace-types'

export interface WorkspaceApi {
  panels: WorkspacePanelState[]
  maximizedId: PanelId | null
  /** The single minimized panel's id, or `null` (#913 — see `workspace-types.ts`). */
  minimizedId: PanelId | null
  isOpen: (id: PanelId) => boolean
  /** Opens `entityType`/`entityId`'s panel, or focuses it if already open —
   *  never duplicates. Un-minimizes it first if it was minimized, since
   *  "open/focus" should always reveal the panel. Returns the panel's id so
   *  the caller can pass it to `focusTarget` consumers. */
  openPanel: (entityType: string, entityId: string, options?: { span?: PanelSpan }) => PanelId
  closePanel: (id: PanelId) => void
  setSpan: (id: PanelId, span: PanelSpan) => void
  maximize: (id: PanelId) => void
  /** Restores the previous (non-maximized) layout. */
  restore: () => void
  /** Minimizes `id` to a title-bar strip; clears `maximizedId` first if `id`
   *  was the maximized panel (a panel is never both at once). */
  minimize: (id: PanelId) => void
  /** Restores `id` from its minimized strip back to its prior span/position. */
  restoreMinimized: (id: PanelId) => void
  /** Replaces the entire open panel set with `panels` in one commit — a full
   *  swap, not a merge with whatever is currently open (#915 "templates" /
   *  perspectives). Also clears `maximizedId` and `minimizedId`, since a
   *  panel from the previous set could no longer be either. Adds a history
   *  entry, same as `openPanel`, since switching templates is a deliberate
   *  navigation an operator would expect to back out of. */
  replacePanels: (panels: Array<{ entityType: string; entityId: string; span?: PanelSpan }>) => void
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
      // Un-minimize on open/focus — a caller asking to open or focus a panel
      // always means "reveal it", even if it was collapsed to a strip.
      const minimizedId = state.minimizedId === id ? null : state.minimizedId
      if (!existing) {
        const panel: WorkspacePanelState = { id, entityType, entityId, span: options?.span ?? DEFAULT_PANEL_SPAN }
        commit({ panels: [...state.panels, panel], maximizedId: state.maximizedId, minimizedId })
      } else if (minimizedId !== state.minimizedId) {
        commit({ panels: state.panels, maximizedId: state.maximizedId, minimizedId }, { addHistoryEntry: false })
      }
      // Opening an already-open panel focuses it rather than duplicating it —
      // no URL change needed, just the focus signal below.
      setFocusTarget(id)
      return id
    },
    [commit, state.maximizedId, state.minimizedId, state.panels],
  )

  const closePanel = useCallback(
    (id: PanelId) => {
      const panels = state.panels.filter(p => p.id !== id)
      const maximizedId = state.maximizedId === id ? null : state.maximizedId
      const minimizedId = state.minimizedId === id ? null : state.minimizedId
      commit({ panels, maximizedId, minimizedId }, { addHistoryEntry: false })
    },
    [commit, state.maximizedId, state.minimizedId, state.panels],
  )

  const setSpan = useCallback(
    (id: PanelId, span: PanelSpan) => {
      const panels = state.panels.map(p => (p.id === id ? { ...p, span } : p))
      commit({ panels, maximizedId: state.maximizedId, minimizedId: state.minimizedId }, { addHistoryEntry: false })
    },
    [commit, state.maximizedId, state.minimizedId, state.panels],
  )

  const maximize = useCallback(
    (id: PanelId) => {
      if (!state.panels.some(p => p.id === id)) return
      // A panel is never both maximized and minimized at once.
      const minimizedId = state.minimizedId === id ? null : state.minimizedId
      commit({ panels: state.panels, maximizedId: id, minimizedId })
      setFocusTarget(id)
    },
    [commit, state.minimizedId, state.panels],
  )

  const restore = useCallback(() => {
    const previousMaximizedId = state.maximizedId
    commit({ panels: state.panels, maximizedId: null, minimizedId: state.minimizedId }, { addHistoryEntry: false })
    setFocusTarget(previousMaximizedId)
  }, [commit, state.maximizedId, state.minimizedId, state.panels])

  const minimize = useCallback(
    (id: PanelId) => {
      if (!state.panels.some(p => p.id === id)) return
      // A panel is never both maximized and minimized at once.
      const maximizedId = state.maximizedId === id ? null : state.maximizedId
      commit({ panels: state.panels, maximizedId, minimizedId: id }, { addHistoryEntry: false })
    },
    [commit, state.maximizedId, state.panels],
  )

  const restoreMinimized = useCallback(
    (id: PanelId) => {
      if (state.minimizedId !== id) return
      commit({ panels: state.panels, maximizedId: state.maximizedId, minimizedId: null }, { addHistoryEntry: false })
      setFocusTarget(id)
    },
    [commit, state.maximizedId, state.minimizedId, state.panels],
  )

  const replacePanels = useCallback(
    (nextPanels: Array<{ entityType: string; entityId: string; span?: PanelSpan }>) => {
      // Deduplicate by id (same rule `decodeWorkspaceState` applies to a
      // hand-edited URL): a malformed caller — a typo'd template, or any
      // future non-`templates.ts` caller — must not produce two panels
      // sharing one id, which would collide on `key`/panel-ref lookups
      // downstream. First occurrence wins; later duplicates are dropped.
      const seen = new Set<PanelId>()
      const panels: WorkspacePanelState[] = []
      for (const { entityType, entityId, span } of nextPanels) {
        const id = makePanelId(entityType, entityId)
        if (seen.has(id)) continue
        seen.add(id)
        panels.push({ id, entityType, entityId, span: span ?? DEFAULT_PANEL_SPAN })
      }
      commit({ panels, maximizedId: null, minimizedId: null })
      setFocusTarget(null)
    },
    [commit],
  )

  const consumeFocusTarget = useCallback(() => setFocusTarget(null), [])

  return {
    panels: state.panels,
    maximizedId: state.maximizedId,
    minimizedId: state.minimizedId,
    isOpen,
    openPanel,
    closePanel,
    setSpan,
    maximize,
    restore,
    minimize,
    restoreMinimized,
    replacePanels,
    focusTarget,
    consumeFocusTarget,
  }
}
