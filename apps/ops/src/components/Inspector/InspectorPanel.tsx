'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import styles from './InspectorPanel.module.css'

interface InspectorPanelProps {
  isOpen: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Fills the `OpsShell` inspector grid slot (E1). One component, two
 * presentations, chosen purely by CSS breakpoint (E6/D4/R1): a full-screen
 * sheet below --ops-breakpoint-xl (80rem/1280px), a docked column at and
 * above it. Both read the same `isOpen`/`title`/`children` props, driven by
 * a URL search param (`useInspectorParam`), so the rendered state is
 * identical after a full reload and shareable via URL. No route branches on
 * which presentation is showing.
 *
 * Follows the same modal contract as `MoreSheet`: focus moves to the close
 * button on open, Tab is trapped within the panel, Escape closes it, and
 * focus returns to whatever was focused before opening (captured
 * internally, so callers don't need to pass a trigger ref). This a11y
 * behavior is intentionally identical at both widths, even though only the
 * sheet presentation visually blocks the rest of the page below 1280px —
 * keeping behavior CSS-driven rather than JS-branched is the point of "one
 * component, two presentations".
 */
export function InspectorPanel({ isOpen, title, onClose, children }: InspectorPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return undefined

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', handleKeydown)

    return () => {
      document.removeEventListener('keydown', handleKeydown)
      previouslyFocusedRef.current?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className={styles.backdrop}>
      <button
        type="button"
        className={styles.backdropButton}
        aria-label={`Dismiss ${title}`}
        tabIndex={-1}
        onClick={onClose}
      />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className={styles.panel}>
        <div className={styles.header}>
          <p className={styles.title}>{title}</p>
          <button
            type="button"
            ref={closeButtonRef}
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
