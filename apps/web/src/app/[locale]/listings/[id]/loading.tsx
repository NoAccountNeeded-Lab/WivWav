import { useTranslations } from 'next-intl'
import styles from './loading.module.css'

export default function ListingLoading() {
  const t = useTranslations('ListingDetail')
  return (
    <div className={styles.page} aria-busy="true" aria-label={t('loadingListing')}>
      <div className={styles.shimmer} />
    </div>
  )
}
