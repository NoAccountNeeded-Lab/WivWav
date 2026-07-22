'use client'

import { usePathname } from 'next/navigation'
import { OPS_NAV_GROUPS } from '@/app/ops/ops-nav'
import { NavLinkItem } from './NavLinkItem'
import { isNavItemActive } from './isActive'
import styles from './NavColumn.module.css'

/**
 * Full grouped navigation column (≥1024px, D2/D5/A3): every group and item
 * in the registry, with a visible active state and `aria-current="page"` on
 * the active link.
 */
export function NavColumn() {
  const pathname = usePathname()

  return (
    <nav aria-label="Ops navigation" className={styles.column}>
      {OPS_NAV_GROUPS.map(group => (
        <section key={group.id} className={styles.group} aria-label={group.title || undefined}>
          {group.title && <h2 className={styles.groupTitle}>{group.title}</h2>}
          <div className={styles.groupItems}>
            {group.items.map(item => (
              <NavLinkItem key={item.href} item={item} isActive={isNavItemActive(pathname, item.href)} />
            ))}
          </div>
        </section>
      ))}
    </nav>
  )
}
