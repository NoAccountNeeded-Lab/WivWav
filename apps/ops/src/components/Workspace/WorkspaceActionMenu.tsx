'use client'

import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { WorkspaceAction } from './WorkspacePanel'
import styles from './WorkspaceActionMenu.module.css'

export interface WorkspaceActionMenuProps {
  label: string
  actions: WorkspaceAction[]
  /** Viewport position to render the menu at, or `null` when closed. */
  position: { top: number; left: number } | null
  onClose: () => void
  onSelect: (action: WorkspaceAction) => void
}

/**
 * Minimal `role="menu"` popup shared by `WorkspacePanel`'s overflow button
 * and its right-click/keyboard context menu — same component, different
 * trigger and anchor position, so both surfaces stay behaviorally identical
 * (WCAG 2.1 AA: arrow-key navigation, Escape closes and returns focus,
 * outside click closes). Deliberately plain HTML/CSS rather than
 * `@wivwav/ui-web`'s MUI-backed `Menu`/`ContextMenu`: `apps/ops` does not
 * yet mount `UiWebProvider` (the 22-variant `ThemePicker` CSS-variable theme
 * system is retained pending the still-open maintainer call in
 * `docs/design/ui-boundary-and-ops-workspace.md` section 6.3), so pulling in
 * an unthemed MUI popup here would look inconsistent with the rest of Ops
 * chrome — this follows `InspectorPanel`'s existing plain-CSS-Modules
 * pattern instead.
 */
export function WorkspaceActionMenu({ label, actions, position, onClose, onSelect }: WorkspaceActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!position) return undefined
    const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
    firstItem?.focus()
    return undefined
  }, [position])

  if (!position) return null

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)

    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(currentIndex + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(currentIndex - 1 + items.length) % items.length]?.focus()
    }
  }

  return (
    <>
      <button type="button" className={styles.backdrop} tabIndex={-1} aria-label={`Dismiss ${label}`} onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className={styles.menu}
        style={{ top: position.top, left: position.left }}
        onKeyDown={handleKeyDown}
      >
        {actions.map(action => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            aria-disabled={action.disabled ?? false}
            className={styles.menuItem}
            disabled={action.disabled ?? false}
            onClick={() => onSelect(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </>
  )
}
