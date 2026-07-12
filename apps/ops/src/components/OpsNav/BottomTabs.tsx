'use client'

import type { RefObject } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { OPS_NAV_GROUPS } from '@/app/ops/ops-nav'
import { getOpsNavIcon } from './nav-icons'
import { isNavItemActive } from './isActive'
import styles from './BottomTabs.module.css'

interface BottomTabsProps {
  isMoreOpen: boolean
  onMoreClick: () => void
  moreButtonRef: RefObject<HTMLButtonElement | null>
}

/**
 * Full items (not the flattened `getOpsMobileTabs()` shape) so an
 * `apiOrigin`/`external` destination — if one is ever given `shell.mobileTab`
 * metadata — still renders as a real `<a>` instead of a same-origin `Link`.
 */
const MOBILE_TAB_ITEMS = OPS_NAV_GROUPS
  .flatMap(group => group.items)
  .filter(item => item.shell?.mobileTab !== undefined)
  .sort((a, b) => (a.shell?.mobileTab?.order ?? 0) - (b.shell?.mobileTab?.order ?? 0))

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
      {MOBILE_TAB_ITEMS.map(item => {
        const Icon = getOpsNavIcon(item.href)
        const label = item.shell?.mobileTab?.label ?? item.title
        const active = isNavItemActive(pathname, item.href)

        if (item.apiOrigin || item.external) {
          return (
            <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className={styles.tab}>
              {Icon && <Icon size={20} aria-hidden="true" />}
              <span className={styles.label}>
                {label}
                <span className="sr-only"> (opens in new tab)</span>
              </span>
            </a>
          )
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            data-active={active || undefined}
            className={styles.tab}
          >
            {Icon && <Icon size={20} aria-hidden="true" />}
            <span className={styles.label}>{label}</span>
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
