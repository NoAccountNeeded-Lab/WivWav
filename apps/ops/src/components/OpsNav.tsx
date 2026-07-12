'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { OPS_NAV_GROUPS, isNavItemActive } from '@/app/ops/ops-nav'
import styles from './OpsNav.module.css'

interface OpsNavProps {
  /** Distinguishes the always-visible desktop column from the mobile sheet, for styling only. */
  variant: 'sidebar' | 'drawer'
  /** Called after a same-app link is activated, so the mobile drawer can close itself. */
  onNavigate?: () => void
}

/**
 * Grouped list of ops destinations, shared by the persistent desktop sidebar
 * and the mobile navigation drawer (see OpsShell). Active-route state is
 * derived from the current pathname rather than passed in, so both renders
 * always agree with the browser location.
 */
export function OpsNav({ variant, onNavigate }: OpsNavProps) {
  const pathname = usePathname()

  return (
    <div className={styles.root} data-variant={variant}>
      {OPS_NAV_GROUPS.map(group => (
        <div key={group.id} className={styles.group}>
          <p className={styles.groupTitle}>{group.title}</p>
          <ul className={styles.itemList}>
            {group.items.map(item => {
              const active = isNavItemActive(pathname, item)

              if (item.external) {
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.itemLink}
                      title={item.desc}
                    >
                      {item.title}
                    </a>
                  </li>
                )
              }

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={styles.itemLink}
                    data-active={active}
                    aria-current={active ? 'page' : undefined}
                    title={item.desc}
                    onClick={() => onNavigate?.()}
                  >
                    {item.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
