'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { Menu, X } from 'lucide-react'
import { getActiveNavItem } from '@/app/ops/ops-nav'
import { ThemePicker } from './ThemePicker'
import styles from './OpsHeader.module.css'

interface OpsHeaderProps {
  /** Overrides the auto-derived section title (used by routes outside the /ops nav model, e.g. /status). */
  section?: ReactNode
  /**
   * When provided, renders a mobile menu toggle button that calls this on
   * click. Omitted by routes that don't have a drawer to open (e.g. login).
   */
  onMenuClick?: () => void
  menuOpen?: boolean
  menuButtonId?: string
  drawerId?: string
}

export function OpsHeader({ section, onMenuClick, menuOpen = false, menuButtonId, drawerId }: OpsHeaderProps) {
  const pathname = usePathname()
  const activeItem = getActiveNavItem(pathname)
  const resolvedSection = section ?? activeItem?.item.title

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.left}>
          {onMenuClick && (
            <button
              type="button"
              id={menuButtonId}
              className={styles.menuButton}
              onClick={onMenuClick}
              aria-expanded={menuOpen}
              aria-controls={drawerId}
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            >
              {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </button>
          )}
          <Link href="/ops" className={styles.brand} aria-label="WivWav Ops — go to ops overview">
            WivWav Ops
          </Link>
          {resolvedSection && (
            <>
              <span className={styles.divider} aria-hidden="true">/</span>
              <span className={styles.section}>{resolvedSection}</span>
            </>
          )}
        </div>
        <div className={styles.right}>
          <span className={styles.live} aria-hidden="true">
            <span className={styles.liveDot} />
            Live
          </span>
          <ThemePicker />
        </div>
      </div>
    </header>
  )
}
