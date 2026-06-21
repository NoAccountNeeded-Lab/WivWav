import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from './Logo'
import { LanguageSwitcher } from './LanguageSwitcher'
import styles from './SiteHeader.module.css'

interface SiteHeaderProps {
  section?: ReactNode
}

export function SiteHeader({ section }: SiteHeaderProps) {
  return (
    <header className={styles.siteHeader}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.logo} aria-label="WivWav — go to home">
          <Logo />
        </Link>
        {section ? (
          <span className={styles.sectionText}>{section}</span>
        ) : (
          <p className={styles.tagline} aria-label="Wheelchair Independence via Wheelchair Accessible Vehicles">
            <span>Wheelchair Independence via</span>
            <span>Wheelchair Accessible Vehicles</span>
          </p>
        )}
        <LanguageSwitcher />
      </div>
    </header>
  )
}
