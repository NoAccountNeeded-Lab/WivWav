'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import styles from './FacetModal.module.css'

interface FacetModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// Tracks how many FacetModal instances are currently open so nested/adjacent
// modals don't clobber each other's body scroll lock: only the modal that
// transitions the count to zero re-enables scrolling.
let openModalCount = 0

/**
 * Centered dialog overlay for showing a facet's full option list without
 * shifting the underlying page layout. Closes on Escape, backdrop click, or
 * the close button; traps focus while open and restores it on close.
 */
export function FacetModal({ title, onClose, children }: FacetModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()

    openModalCount += 1
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      openModalCount = Math.max(0, openModalCount - 1)
      if (openModalCount === 0) document.body.style.overflow = ''
      previouslyFocused?.focus()
    }
  }, [onClose])

  function handleBackdropMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose()
  }

  return createPortal(
    // Backdrop-click-to-close is a pointer-only convenience: Escape (handled
    // above) is the keyboard equivalent, and the focus trap keeps keyboard
    // users inside the panel, so the backdrop itself is never tab-reachable.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles.backdrop} onMouseDown={handleBackdropMouseDown}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.header}>
          <span id={titleId} className={styles.title}>{title}</span>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
