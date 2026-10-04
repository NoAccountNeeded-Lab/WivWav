'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import styles from './helm-inspector.module.css'

interface InspectorDialogProps {
  titleId: string
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', 'summary', '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => element.getAttribute('aria-hidden') !== 'true')
}

/**
 * Full-screen modal used below 1280px. Focus moves in on open and is trapped
 * with Tab/Shift+Tab, Escape closes, and the host marks the rest of the page
 * `inert` while it is mounted. Restoring focus to the opener is done by the
 * host (`useFocusReturn`) so desktop and narrow share one behaviour.
 */
export function InspectorDialog({ titleId, onClose, children }: InspectorDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const heading = dialog.querySelector<HTMLElement>(`#${titleId}`)
    ;(heading ?? dialog).focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [titleId])

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    function onKeyDown(event: KeyboardEvent) {
      const root = dialogRef.current
      if (!root) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusableWithin(root)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) {
        event.preventDefault()
        return
      }
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === root || active?.id === titleId)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      } else if (!root.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => dialog.removeEventListener('keydown', onKeyDown)
  }, [titleId])

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={styles.dialog}
    >
      {children}
    </div>
  )
}
