'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { WorkspacePanel, type WorkspaceAction, type WorkspacePanelHandle } from './WorkspacePanel'
import type { WorkspaceApi } from './useWorkspaceState'
import type { PanelId, WorkspacePanelState } from './workspace-types'
import styles from './WorkspaceGrid.module.css'

export interface WorkspacePanelContent {
  title: string
  actions?: WorkspaceAction[]
  content: ReactNode
}

export interface WorkspaceGridProps {
  workspace: WorkspaceApi
  /** Entity-specific content is unknown to the generic workspace contract —
   *  the caller (e.g. a future #761 route) supplies title/actions/content
   *  per open panel's `{entityType, entityId}`. */
  renderPanel: (panel: WorkspacePanelState) => WorkspacePanelContent
  emptyState?: ReactNode
}

/**
 * Lays out the open panel set from `useWorkspaceState` in a CSS Grid with
 * declarable column spans (#854, decision record section 3 "Layout / span").
 * When a panel is maximized, this is the component that actually removes
 * every other panel from the DOM (not just visually hides them) so they are
 * simultaneously invisible and out of the tab order — the concrete mechanism
 * behind "maximize is a layout mode, not a modal dialog".
 */
export function WorkspaceGrid({ workspace, renderPanel, emptyState }: WorkspaceGridProps) {
  const panelRefs = useRef(new Map<PanelId, WorkspacePanelHandle | null>())
  const { panels, maximizedId, focusTarget, consumeFocusTarget, closePanel, maximize, restore } = workspace

  useEffect(() => {
    if (!focusTarget) return
    const handle = panelRefs.current.get(focusTarget)
    if (!handle) return
    handle.focusHeading()
    consumeFocusTarget()
  }, [focusTarget, consumeFocusTarget, panels])

  // Escape restores the previous layout while a panel is maximized — a
  // document-level listener because the maximized panel's own content may
  // hold focus anywhere inside it, not just on a dialog-style element.
  useEffect(() => {
    if (!maximizedId) return undefined
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') restore()
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [maximizedId, restore])

  if (panels.length === 0) {
    return emptyState ? <div className={styles.empty}>{emptyState}</div> : null
  }

  const maximizedPanel = maximizedId ? panels.find(p => p.id === maximizedId) : undefined

  if (maximizedPanel) {
    const { title, actions, content } = renderPanel(maximizedPanel)
    return (
      <div className={styles.maximizedWrap}>
        <WorkspacePanel
          ref={handle => {
            panelRefs.current.set(maximizedPanel.id, handle)
          }}
          title={title}
          actions={actions ?? []}
          isMaximized
          onClose={() => closePanel(maximizedPanel.id)}
          onMaximize={() => maximize(maximizedPanel.id)}
          onRestore={restore}
        >
          {content}
        </WorkspacePanel>
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      {panels.map(panel => {
        const { title, actions, content } = renderPanel(panel)
        return (
          <div key={panel.id} className={styles.gridItem} data-span={panel.span}>
            <WorkspacePanel
              ref={handle => {
                panelRefs.current.set(panel.id, handle)
              }}
              title={title}
              actions={actions ?? []}
              isMaximized={false}
              onClose={() => closePanel(panel.id)}
              onMaximize={() => maximize(panel.id)}
              onRestore={restore}
            >
              {content}
            </WorkspacePanel>
          </div>
        )
      })}
    </div>
  )
}
