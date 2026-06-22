import Link from 'next/link'
import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Logo } from './Logo'
import { LanguageSwitcher } from './LanguageSwitcher'
import styles from './SiteHeader.module.css'

interface SiteHeaderProps {
  section?: ReactNode
  locale?: string
}

export async function SiteHeader({ section, locale }: SiteHeaderProps) {
  const t = locale
    ? await getTranslations({ locale, namespace: 'SiteHeader' })
    : await getTranslations('SiteHeader')

  return (
    <header className={styles.siteHeader}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.logo} aria-label={t('homeAriaLabel')}>
          <Logo />
        </Link>
        {section ? (
          <span className={styles.sectionText}>{section}</span>
        ) : (
          <p className={styles.tagline} aria-label={t('taglineAriaLabel')}>
            <span>{t('taglinePart1')}</span>
            <span>{t('taglinePart2')}</span>
          </p>
        )}
        <LanguageSwitcher />
      </div>
    </header>
  )
}
