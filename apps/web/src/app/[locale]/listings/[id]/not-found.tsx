import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import styles from './not-found.module.css'

export default function ListingNotFound() {
  const t = useTranslations('ListingDetail')
  return (
    <main id="main-content" className={styles.page}>
      <div className={styles.card}>
        <p className={styles.message}>
          <strong>{t('notFoundMessage')}</strong> {t('notFoundDetail')}
        </p>
        <Link href="/filters" className={styles.cta}>
          {t('browseAllListings')}
        </Link>
      </div>
    </main>
  )
}
