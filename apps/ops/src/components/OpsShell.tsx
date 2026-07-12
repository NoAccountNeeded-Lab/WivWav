'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { OpsHeader } from './OpsHeader'
import { OpsNav } from './OpsNav'
import styles from './OpsShell.module.css'

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface OpsShellProps {
  children: ReactNode
}

/**
 * App shell for the /ops route tree: sticky header, a nav column that's
 * persistent at tablet/desktop widths and collapses into a mobile drawer
 * below that, and the routed page content.
 *
 * The far-right operator detail panel described in #722 (queue job detail,
 * source detail, run detail, etc.) is intentionally deferred — see the
 * follow-up issue linked from the #722 PR — so this shell only owns the
 * two-column nav/content structure for now.
 */
export function OpsShell({ children }: OpsShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()
  const drawerId = useId()
  const menuButtonId = useId()
  const drawerRef = useRef<HTMLDivElement>(null)

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    document.getElementById(menuButtonId)?.focus()
  }, [menuButtonId])

  // Route changes (drawer link click, browser back/forward, deep link) always
  // close the drawer so the new page is never left obscured.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Scroll lock + focus management while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    firstFocusable?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDrawer()
        return
      }

      if (e.key !== 'Tab' || !drawerRef.current) return

      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0] as HTMLElement
      const last = focusable[focusable.length - 1] as HTMLElement

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [drawerOpen, closeDrawer])

  return (
    <>
      <OpsHeader
        onMenuClick={() => setDrawerOpen(o => !o)}
        menuOpen={drawerOpen}
        menuButtonId={menuButtonId}
        drawerId={drawerId}
      />
      <div className={styles.shell}>
        {/* `inert` while the drawer is open keeps the persistent sidebar and
            routed content out of the keyboard/AT tree entirely, on top of
            the dialog's own aria-modal — belt and suspenders for the modal
            contract. The header (brand link, live indicator, theme picker,
            menu button) is deliberately left out of this: the menu button
            itself must stay focusable so closeDrawer() can return focus to
            it, and splitting it from its sibling controls isn't worth the
            added complexity for a small header. */}
        <nav className={styles.sidebar} aria-label="Ops sections" inert={drawerOpen}>
          <OpsNav variant="sidebar" />
        </nav>

        {drawerOpen && (
          <>
            {/* Decorative dismiss surface — Escape and the header's own toggle button already provide keyboard equivalents for closing the drawer. */}
            <div className={styles.backdrop} onClick={closeDrawer} aria-hidden="true" />
            <div
              id={drawerId}
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Ops navigation"
              className={styles.drawer}
            >
              <OpsNav variant="drawer" onNavigate={closeDrawer} />
            </div>
          </>
        )}

        <div className={styles.content} inert={drawerOpen}>{children}</div>
      </div>
    </>
  )
}
