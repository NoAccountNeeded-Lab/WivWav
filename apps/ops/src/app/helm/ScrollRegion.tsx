import type { ReactNode } from 'react'
import styles from './helm-sections.module.css'

/**
 * Horizontally scrollable wrapper for a wide table. It is focusable so a
 * keyboard user can scroll it (WCAG 2.1.1; axe scrollable-region-focusable)
 * and named so the stop is announced.
 */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users must be able to scroll an overflowing table
    <div className={styles.tableScroll} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  )
}
