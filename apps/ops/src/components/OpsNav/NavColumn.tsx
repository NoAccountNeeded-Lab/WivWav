'use client'

import { usePathname } from 'next/navigation'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { OPS_NAV_GROUPS } from '@/app/ops/ops-nav'
import { NavLinkItem } from './NavLinkItem'
import { NavRailItem } from './NavRailItem'
import { isNavItemActive } from './isActive'
import { useNavCollapsed } from './useNavCollapsed'
import styles from './NavColumn.module.css'

/**
 * Full grouped navigation column (≥1024px, D2/D5/A3): every group and item
 * in the registry, with a visible active state and `aria-current="page"` on
 * the active link.
 *
 * Collapsible to an icon-only rail (#911): the toggle button's accessible
 * name flips between "Collapse navigation" / "Expand navigation", the choice
 * persists across reloads via `useNavCollapsed`, and collapsed rows reuse
 * `NavRailItem` (the same icon markup as the 768–1023px `NavRail`) rather
 * than duplicating icon SVGs. Every item stays a real, keyboard-focusable
 * link with its accessible name unchanged in both states — only the visible
 * label text is hidden when collapsed.
 */
export function NavColumn() {
  const pathname = usePathname()
  const [collapsed, toggleCollapsed] = useNavCollapsed()

  return (
    <nav
      aria-label="Ops navigation"
      className={styles.column}
      data-collapsed={collapsed || undefined}
    >
      <button
        type="button"
        className={styles.toggle}
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      >
        {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
        {!collapsed && <span>Collapse</span>}
      </button>
      {OPS_NAV_GROUPS.map(group => (
        <section key={group.id} className={styles.group} aria-label={group.title || undefined}>
          {!collapsed && group.title && <h2 className={styles.groupTitle}>{group.title}</h2>}
          <div className={styles.groupItems}>
            {group.items.map(item =>
              collapsed ? (
                <NavRailItem key={item.href} item={item} isActive={isNavItemActive(pathname, item.href)} />
              ) : (
                <NavLinkItem key={item.href} item={item} isActive={isNavItemActive(pathname, item.href)} />
              ),
            )}
          </div>
        </section>
      ))}
    </nav>
  )
}
