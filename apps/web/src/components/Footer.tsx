import Link from 'next/link'
import { Shield, ScrollText } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import styles from './Footer.module.css'

interface FooterProps {
  locale?: string
}

export async function Footer({ locale }: FooterProps = {}) {
  const t = locale
    ? await getTranslations({ locale, namespace: 'Footer' })
    : await getTranslations('Footer')
  const year = new Date().getFullYear()

  return (
    <footer className={styles.footer} aria-label="Site footer">
      <div className={styles.inner}>
        <p className={styles.copy}>
          &copy; {year} WivWav. {t('informational')}
        </p>
        <nav aria-label="Legal links">
          <ul className={styles.nav}>
            <li>
              <Link href="/privacy" className={styles.navLink} aria-label="Privacy Policy">
                <Shield size={15} strokeWidth={1.5} aria-hidden="true" />
              </Link>
            </li>
            <li>
              <Link href="/terms" className={styles.navLink} aria-label="Terms of Service">
                <ScrollText size={15} strokeWidth={1.5} aria-hidden="true" />
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  )
}
