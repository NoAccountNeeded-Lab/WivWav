import { MobileNav } from './MobileNav'
import { NavRail } from './NavRail'
import { NavColumn } from './NavColumn'
import styles from './OpsNav.module.css'

/**
 * Composes every responsive nav surface (D2/D5/A3): bottom tabs + More sheet
 * below 768px, a persistent icon rail 768–1023px, and the full grouped
 * column at 1024px and up. All three render unconditionally; `OpsNav.module.css`
 * uses `min-width` media queries against the E1 breakpoint tokens to show
 * exactly one at a time — no JS width listeners.
 */
export function OpsNav() {
  return (
    <>
      <div className={styles.mobileOnly}>
        <MobileNav />
      </div>
      <div className={styles.railOnly}>
        <NavRail />
      </div>
      <div className={styles.columnOnly}>
        <NavColumn />
      </div>
    </>
  )
}
