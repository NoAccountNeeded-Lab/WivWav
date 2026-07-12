'use client'

import type { RefObject } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { getOpsMobileTabs } from '@/app/ops/ops-nav'
import { getOpsNavIcon } from './nav-icons'
import { isNavItemActive } from './isActive'
import styles from './BottomTabs.module.css'

interface BottomTabsProps {
  isMoreOpen: boolean
  onMoreClick: () => void
  moreButtonRef: RefObject<HTMLButtonElement | null>
}

const MOBILE_TABS = getOpsMobileTabs()

/**
 * Primary mobile navigation (< 768px, D2/D5/A3): the metadata-seeded tab set
 * plus a trailing "More" tab that opens the full registry sheet. Tab
 * membership is driven entirely by `shell.mobileTab` in `ops-nav.ts` — never
 * hardcoded here.
 */
export function BottomTabs({ isMoreOpen, onMoreClick, moreButtonRef }: BottomTabsProps) {
  const pathname = usePathname()

  return (
    <nav aria-label="Primary" className={styles.bar}>
      {MOBILE_TABS.map(tab => {
        const Icon = getOpsNavIcon(tab.href)
        const active = isNavItemActive(pathname, tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            data-active={active || undefined}
            className={styles.tab}
          >
            {Icon && <Icon size={20} aria-hidden="true" />}
            <span className={styles.label}>{tab.label}</span>
          </Link>
        )
      })}
      <button
        type="button"
        ref={moreButtonRef}
        className={styles.tab}
        aria-haspopup="dialog"
        aria-expanded={isMoreOpen}
        onClick={onMoreClick}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
        <span className={styles.label}>More</span>
      </button>
    </nav>
  )
}
