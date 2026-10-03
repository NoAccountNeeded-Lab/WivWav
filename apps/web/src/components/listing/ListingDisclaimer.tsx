import { Info } from 'lucide-react'
import { useTranslations } from 'next-intl'
import styles from './ListingDisclaimer.module.css'

export type DisclaimerCategory = 'listing' | 'safety' | 'market'

interface ListingDisclaimerProps {
  /**
   * Which data-category notes to show — each category lives on the tab
   * where that data actually appears (safety on the Safety tab, market on
   * the Market tab) rather than all bundled on Overview. Defaults to just
   * `listing`, the category the Overview tab itself covers.
   */
  categories?: DisclaimerCategory[]
}

/**
 * Disclaimer displayed near decision-impacting listing data. Explains that
 * WivWav aggregates listings and is not the seller or the source of truth —
 * users should verify with the original source.
 */
export function ListingDisclaimer({ categories = ['listing'] }: ListingDisclaimerProps) {
  const t = useTranslations('ListingDetail')
  return (
    <div role="note" className={styles.disclaimer} aria-label={t('disclaimerLabel')}>
      <Info size={13} className={styles.icon} aria-hidden />
      <dl className={styles.categories}>
        {categories.map((key) => (
          <div className={styles.category} key={key}>
            <dt className={styles.categoryLabel}>{t(`disclaimer.${key}.label`)}</dt>
            <dd className={styles.categoryText}>{t(`disclaimer.${key}.text`)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
