'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, MoreVertical, X } from 'lucide-react'
import styles from './GridPanel.module.css'

export type PanelSize = 'small' | 'medium' | 'large'

const SIZE_ORDER: PanelSize[] = ['small', 'medium', 'large']
const SIZE_LABELS: Record<PanelSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' }

export interface GridPanelProps {
  title: string
  size: PanelSize
  collapsed: boolean
  onSizeChange: (size: PanelSize) => void
  onToggleCollapse: () => void
  onClose: () => void
  children: ReactNode
}

/**
 * Route-local widget-panel chrome for the dashboard-grid comparison route
 * (#912) — deliberately not `@/components/Workspace`, which carries
 * entity-panel semantics (focus, deep-linking, maximize/restore) this
 * "Apple Home-screen-widget" preset-size/collapse/close panel doesn't need.
 *
 * Size is a fixed Small/Medium/Large preset (not freehand drag-resize — a
 * non-goal per the ratified #851 architecture decision), applied via a
 * `data-size` attribute the CSS module maps to a grid column/row span.
 * Collapsing unmounts `children` entirely (not just visually hides them) so
 * a collapsed panel never keeps polling/rendering work its content would
 * otherwise do, while the header stays so the panel keeps occupying its
 * grid cell at minimum height.
 *
 * The size menu follows the same focus-management contract as the
 * codebase's other `role="menu"` popup (`WorkspaceActionMenu`: focus the
 * first item on open, arrow keys move between items, Escape/outside-click/
 * selection close and return focus to the trigger) so keyboard and
 * screen-reader users never lose their place after changing a preset.
 */
export function GridPanel({ title, size, collapsed, onSizeChange, onToggleCollapse, onClose, children }: GridPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  function closeMenu() {
    setMenuOpen(false)
    menuButtonRef.current?.focus()
  }

  useEffect(() => {
    if (!menuOpen) return undefined

    const firstItem = menuWrapRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')
    firstItem?.focus()

    function handlePointerDown(event: PointerEvent) {
      if (menuWrapRef.current && !menuWrapRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') closeMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuWrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(currentIndex + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(currentIndex - 1 + items.length) % items.length]?.focus()
    }
  }

  return (
    <section className={styles.panel} data-size={size} data-collapsed={collapsed} aria-label={title}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          >
            {collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
          </button>

          <div className={styles.menuWrap} ref={menuWrapRef}>
            <button
              ref={menuButtonRef}
              type="button"
              className={styles.iconButton}
              onClick={() => setMenuOpen(open => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`${title} size options`}
            >
              <MoreVertical size={14} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu" aria-label={`${title} size`} tabIndex={-1} onKeyDown={handleMenuKeyDown}>
                {SIZE_ORDER.map(option => (
                  <button
                    key={option}
                    type="button"
                    role="menuitemradio"
                    aria-checked={size === option}
                    data-active={size === option}
                    className={styles.menuItem}
                    onClick={() => {
                      onSizeChange(option)
                      closeMenu()
                    }}
                  >
                    {SIZE_LABELS[option]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      {!collapsed && <div className={styles.body}>{children}</div>}
    </section>
  )
}
