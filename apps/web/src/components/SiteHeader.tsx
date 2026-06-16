import Link from 'next/link'
import type { ReactNode } from 'react'
import styles from './SiteHeader.module.css'

interface SiteHeaderProps {
  section?: ReactNode
}

export function SiteHeader({ section }: SiteHeaderProps) {
  return (
    <header className={styles.siteHeader}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.logo} aria-label="WivWav — go to home">
          Wiv<span className={styles.logoAccent}>Wav</span>
        </Link>
        {section && (
          <>
            <span className={styles.divider} aria-hidden="true">/</span>
            <span className={styles.sectionText}>{section}</span>
          </>
        )}
      </div>
    </header>
  )
}
