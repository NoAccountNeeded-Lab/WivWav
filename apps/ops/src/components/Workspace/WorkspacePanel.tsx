'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { MoreHorizontal, Maximize2, Minimize2, X } from 'lucide-react'
import { WorkspaceActionMenu } from './WorkspaceActionMenu'
import styles from './WorkspacePanel.module.css'

export interface WorkspaceAction {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
}

export interface WorkspacePanelHandle {
  /** Imperatively moves focus to this panel's heading. Called by
   *  `WorkspaceGrid` when this panel becomes the hook's `focusTarget`
   *  (on open-when-already-open, maximize, and restore). */
  focusHeading: () => void
}

export interface WorkspacePanelProps {
  title: string
  /** Same entity actions surfaced three ways per the decision record: as
   *  visible buttons (first two), an overflow menu (all), and a
   *  keyboard-accessible context menu (all) — no action is context-menu-only. */
  actions?: WorkspaceAction[]
  isMaximized: boolean
  onClose: () => void
  onMaximize: () => void
  onRestore: () => void
  children: ReactNode
}

const VISIBLE_ACTION_LIMIT = 2

/**
 * One open entity panel in the Ops workspace (#854, decision record section
 * 3). Unlike `InspectorPanel`, this is never a modal: it's a landmark region
 * that lives in `WorkspaceGrid`'s normal document flow (or, when maximized,
 * is the only panel `WorkspaceGrid` renders — see that component for why
 * maximize is a layout mode, not a dialog).
 */
export const WorkspacePanel = forwardRef<WorkspacePanelHandle, WorkspacePanelProps>(function WorkspacePanel(
  { title, actions = [], isMaximized, onClose, onMaximize, onRestore, children },
  ref,
) {
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const overflowTriggerRef = useRef<HTMLButtonElement>(null)
  const [overflowPosition, setOverflowPosition] = useState<{ top: number; left: number } | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ top: number; left: number } | null>(null)

  useImperativeHandle(ref, () => ({
    focusHeading: () => headingRef.current?.focus(),
  }))

  const closeOverflow = useCallback(() => {
    setOverflowPosition(null)
    overflowTriggerRef.current?.focus()
  }, [])
  const closeContextMenu = useCallback(() => setContextMenuPosition(null), [])

  const openOverflow = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setOverflowPosition({ top: rect.bottom + 4, left: rect.right - 160 })
  }, [])

  // Right-click and its keyboard equivalents (Shift+F10, the keyboard
  // "Menu"/"Apps" key) both open the same context menu — attached
  // imperatively to the landmark `<section>` (rather than as JSX
  // `onContextMenu`/`onKeyDown` props) because a `<section>` is not an
  // interactive element and jsx-a11y's `no-noninteractive-element-interactions`
  // rightly rejects mouse/keyboard handlers declared directly on one; the
  // `<section>` itself keeps only `aria-label`, preserving the plain
  // "region" landmark role the workspace contract requires (WCAG 2.1 AA —
  // no action may be context-menu-only or mouse-only, so the keyboard path
  // matters as much as the pointer one).
  useEffect(() => {
    const node = sectionRef.current
    if (!node) return undefined

    function handleContextMenu(event: MouseEvent) {
      event.preventDefault()
      setContextMenuPosition({ top: event.clientY, left: event.clientX })
    }

    function handleKeyDown(event: KeyboardEvent) {
      const isContextMenuShortcut = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)
      if (!isContextMenuShortcut) return
      event.preventDefault()
      const rect = sectionRef.current?.getBoundingClientRect()
      if (!rect) return
      setContextMenuPosition({ top: rect.top + 48, left: rect.left + 16 })
    }

    node.addEventListener('contextmenu', handleContextMenu)
    node.addEventListener('keydown', handleKeyDown)
    return () => {
      node.removeEventListener('contextmenu', handleContextMenu)
      node.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const visibleActions = actions.slice(0, VISIBLE_ACTION_LIMIT)

  function runAction(action: WorkspaceAction) {
    closeOverflow()
    closeContextMenu()
    action.onSelect()
  }

  return (
    <section
      ref={sectionRef}
      aria-label={title}
      className={styles.panel}
      data-maximized={isMaximized ? 'true' : 'false'}
    >
      <div className={styles.header}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.title}>
          {title}
        </h2>
        <div className={styles.headerActions}>
          {visibleActions.map(action => (
            <button
              key={action.id}
              type="button"
              className={styles.actionButton}
              onClick={() => runAction(action)}
              disabled={action.disabled ?? false}
            >
              {action.label}
            </button>
          ))}
          {actions.length > 0 && (
            <button
              ref={overflowTriggerRef}
              type="button"
              className={styles.iconButton}
              aria-label={`More actions for ${title}`}
              aria-haspopup="menu"
              aria-expanded={overflowPosition !== null}
              onClick={openOverflow}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            aria-label={isMaximized ? `Restore ${title}` : `Maximize ${title}`}
            aria-pressed={isMaximized}
            onClick={isMaximized ? onRestore : onMaximize}
          >
            {isMaximized ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          </button>
          <button type="button" className={styles.iconButton} aria-label={`Close ${title}`} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={styles.body}>{children}</div>

      <WorkspaceActionMenu
        label={`${title} actions`}
        actions={actions}
        position={overflowPosition}
        onClose={closeOverflow}
        onSelect={runAction}
      />
      <WorkspaceActionMenu
        label={`${title} context menu`}
        actions={actions}
        position={contextMenuPosition}
        onClose={closeContextMenu}
        onSelect={runAction}
      />
    </section>
  )
})
