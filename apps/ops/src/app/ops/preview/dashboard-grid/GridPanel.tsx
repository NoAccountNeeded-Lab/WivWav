'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
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
 */
export function GridPanel({ title, size, collapsed, onSizeChange, onToggleCollapse, onClose, children }: GridPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return undefined

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

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

          <div className={styles.menuWrap} ref={menuRef}>
            <button
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
              <div className={styles.menu} role="menu" aria-label={`${title} size`}>
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
                      setMenuOpen(false)
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
