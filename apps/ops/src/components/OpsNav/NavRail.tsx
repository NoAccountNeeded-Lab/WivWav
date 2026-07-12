'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { OPS_NAV_GROUPS } from '@/app/ops/ops-nav'
import { getOpsNavIcon } from './nav-icons'
import { isNavItemActive } from './isActive'
import { MoreSheet } from './MoreSheet'
import { useNavSheet } from './useNavSheet'
import styles from './NavRail.module.css'

const RAIL_ITEMS = OPS_NAV_GROUPS
  .flatMap(group => group.items)
  .filter(item => item.shell?.placement === 'primary')

/**
 * Persistent icon rail (768–1023px, D2/D5/A3): primary-placement destinations
 * as icon-only links, plus a "More" trigger that opens the same full-registry
 * sheet used by the mobile bottom tabs.
 */
export function NavRail() {
  const pathname = usePathname()
  const { isOpen, toggle, close, triggerRef } = useNavSheet<HTMLButtonElement>()

  return (
    <>
      <nav aria-label="Primary" className={styles.rail}>
        {RAIL_ITEMS.map(item => {
          const Icon = getOpsNavIcon(item.href)
          const active = isNavItemActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              data-active={active || undefined}
              className={styles.item}
              title={item.title}
            >
              {Icon && <Icon size={20} aria-hidden="true" />}
              <span className="sr-only">{item.title}</span>
            </Link>
          )
        })}
        <button
          type="button"
          ref={triggerRef}
          className={styles.item}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          title="More"
          onClick={toggle}
        >
          <MoreHorizontal size={20} aria-hidden="true" />
          <span className="sr-only">More</span>
        </button>
      </nav>
      <MoreSheet isOpen={isOpen} onClose={close} triggerRef={triggerRef} />
    </>
  )
}
