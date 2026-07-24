'use client'

import Link from 'next/link'
import type { OpsNavItem } from '@/app/ops/ops-nav'
import { getOpsNavIcon } from './nav-icons'
import { useNavItemInterceptor } from './nav-item-interceptor'
import { useViewTransitionNav } from './useViewTransitionNav'
import styles from './NavRail.module.css'

interface NavRailItemProps {
  item: OpsNavItem
  isActive: boolean
}

/**
 * A single icon-only nav destination (44px WCAG touch target), shared by the
 * 768–1023px `NavRail` and the collapsed state of the ≥1024px `NavColumn`
 * (#911) — so both surfaces render the exact same icon markup instead of
 * duplicating SVGs. `title` gives a native tooltip; the visually hidden
 * `sr-only` span preserves each item's accessible name.
 *
 * Also honors `useNavItemInterceptor` (#913) so a route-scoped interceptor
 * catches clicks the same way it does for `BottomTabs`, regardless of which
 * shared surface rendered this item.
 */
export function NavRailItem({ item, isActive }: NavRailItemProps) {
  const Icon = getOpsNavIcon(item.href)
  const viewTransitionNav = useViewTransitionNav()
  const interceptNavItem = useNavItemInterceptor()

  if (item.apiOrigin || item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={styles.item} title={item.title}>
        {Icon && <Icon size={20} aria-hidden="true" />}
        <span className="sr-only">{item.title} (opens in new tab)</span>
      </a>
    )
  }

  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      data-active={isActive || undefined}
      className={styles.item}
      title={item.title}
      onClick={event => {
        if (interceptNavItem?.(item)) {
          event.preventDefault()
          return
        }
        viewTransitionNav(event, item.href)
      }}
    >
      {Icon && <Icon size={20} aria-hidden="true" />}
      <span className="sr-only">{item.title}</span>
    </Link>
  )
}
