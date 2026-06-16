import Link from 'next/link'
import styles from './Footer.module.css'

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className={styles.footer} aria-label="Site footer">
      <div className={styles.inner}>
        <p className={styles.copy}>
          &copy; {year} WAV Search. Informational use only.
        </p>
        <nav aria-label="Legal links">
          <ul className={styles.nav}>
            <li>
              <Link href="/privacy" className={styles.navLink}>
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link href="/terms" className={styles.navLink}>
                Terms of Service
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  )
}
