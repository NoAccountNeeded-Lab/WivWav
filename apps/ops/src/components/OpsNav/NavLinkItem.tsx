import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import type { OpsNavItem } from '@/app/ops/ops-nav'
import { getOpsNavIcon } from './nav-icons'
import { useNavItemInterceptor } from './nav-item-interceptor'
import { useViewTransitionNav } from './useViewTransitionNav'
import styles from './NavLinkItem.module.css'

interface NavLinkItemProps {
  item: OpsNavItem
  /** Current pathname, used to derive the active/aria-current state. */
  isActive: boolean
  /** Show the item description below the title (used by the full column/sheet). */
  showDesc?: boolean
  /** Called after the link is activated, e.g. to close a containing sheet. */
  onNavigate?: () => void
  className?: string
}

/**
 * A single nav destination shared by the bottom tabs, icon rail, full column,
 * and More sheet. `item.apiOrigin` destinations (Bull Board) always render as
 * a real `<a>` — never a Next `Link` — because they resolve to a route
 * handler that proxies to the API and must do a full page navigation, not a
 * client-side transition. See `apps/ops/src/app/admin/board/[[...path]]/route.ts`.
 */
export function NavLinkItem({ item, isActive, showDesc, onNavigate, className }: NavLinkItemProps) {
  const Icon = getOpsNavIcon(item.href)
  const rowClassName = [styles.item, className].filter(Boolean).join(' ')
  const viewTransitionNav = useViewTransitionNav()
  const interceptNavItem = useNavItemInterceptor()

  if (item.apiOrigin || item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={rowClassName}
        onClick={onNavigate}
      >
        {Icon && <Icon size={18} aria-hidden="true" className={styles.icon} />}
        <span className={styles.textCol}>
          <span className={styles.label}>
            {item.title}
            <ExternalLink size={13} aria-hidden="true" className={styles.externalIcon} />
            <span className="sr-only"> (opens in new tab)</span>
          </span>
          {showDesc && <span className={styles.desc}>{item.desc}</span>}
        </span>
      </a>
    )
  }

  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={rowClassName}
      data-active={isActive || undefined}
      onClick={event => {
        if (interceptNavItem?.(item)) {
          event.preventDefault()
          onNavigate?.()
          return
        }
        viewTransitionNav(event, item.href)
        onNavigate?.()
      }}
    >
      {Icon && <Icon size={18} aria-hidden="true" className={styles.icon} />}
      <span className={styles.textCol}>
        <span className={styles.label}>{item.title}</span>
        {showDesc && <span className={styles.desc}>{item.desc}</span>}
      </span>
    </Link>
  )
}
