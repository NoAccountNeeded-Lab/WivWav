'use client'

import { type RefObject, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { OPS_NAV_GROUPS } from '@/app/ops/ops-nav'
import { NavLinkItem } from './NavLinkItem'
import { isNavItemActive } from './isActive'
import styles from './MoreSheet.module.css'

interface MoreSheetProps {
  isOpen: boolean
  onClose: () => void
  /** The button that opens the sheet; focus returns here on every close path. */
  triggerRef: RefObject<HTMLElement | null>
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The full navigation registry, reachable from the bottom tabs' "More" button
 * (and, at wider viewports, the icon rail's "More" button). Behaves as a
 * focus-trapped modal dialog: Esc closes it, selecting a destination closes
 * it, and closing it — by any path — returns focus to whichever trigger
 * opened it.
 */
export function MoreSheet({ isOpen, onClose, triggerRef }: MoreSheetProps) {
  const pathname = usePathname()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)

  // Focus the panel's close button on open; trap Tab within the panel; close on Esc.
  useEffect(() => {
    if (!isOpen) return undefined

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
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeydown)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  // Auto-close on breakpoint crossing. `MobileNav` and `NavRail` each mount
  // their own `MoreSheet` instance and only their active surface is visible
  // at a given width (the others are `display: none`, per OpsNav.module.css);
  // resizing across a breakpoint while a sheet is open would otherwise hide
  // it without ever running its close cleanup, leaving `document.body`
  // permanently unscrollable. This does not drive which nav surface renders
  // (that stays CSS-only) — it only dismisses an already-open dialog whose
  // trigger is about to disappear.
  useEffect(() => {
    if (!isOpen || typeof window.matchMedia !== 'function') return undefined

    const queries = ['(min-width: 48rem)', '(min-width: 64rem)'].map(query => window.matchMedia(query))
    queries.forEach(mql => mql.addEventListener('change', onClose))

    return () => {
      queries.forEach(mql => mql.removeEventListener('change', onClose))
    }
  }, [isOpen, onClose])

  // Return focus to the trigger whenever the sheet transitions from open to closed.
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true
      return
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false
      triggerRef.current?.focus()
    }
  }, [isOpen, triggerRef])

  if (!isOpen) return null

  return (
    <div className={styles.backdrop}>
      <button
        type="button"
        className={styles.backdropButton}
        aria-label="Dismiss navigation"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="More navigation"
        className={styles.panel}
      >
        <div className={styles.header}>
          <p className={styles.title}>More</p>
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
        <div className={styles.body}>
          {OPS_NAV_GROUPS.map(group => (
            <section key={group.id} className={styles.group} aria-labelledby={`more-group-${group.id}`}>
              <h2 id={`more-group-${group.id}`} className={styles.groupTitle}>{group.title}</h2>
              <div className={styles.groupItems}>
                {group.items.map(item => (
                  <NavLinkItem
                    key={item.href}
                    item={item}
                    isActive={isNavItemActive(pathname, item.href)}
                    showDesc
                    onNavigate={onClose}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
