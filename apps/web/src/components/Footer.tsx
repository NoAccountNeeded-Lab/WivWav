import Link from 'next/link'
import { Shield, ScrollText } from 'lucide-react'
import styles from './Footer.module.css'

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className={styles.footer} aria-label="Site footer">
      <div className={styles.inner}>
        <p className={styles.copy}>
          &copy; {year} WivWav. Informational use only.
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
