import { Info } from 'lucide-react'
import styles from './ListingDisclaimer.module.css'

export type DisclaimerCategory = 'listing' | 'safety' | 'market'

const CATEGORIES: Record<DisclaimerCategory, { label: string; text: string }> = {
  listing: {
    label: 'Listing data',
    text: 'Price, availability, and all seller-provided details come from the original source and may change. Verify with the seller before making decisions.',
  },
  safety: {
    label: 'Safety ratings & recalls',
    text: 'Sourced from NHTSA. Not provided by the seller.',
  },
  market: {
    label: 'Market pricing',
    text: 'Reflects WivWav index data only and may not represent current market conditions.',
  },
}

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
  return (
    <div role="note" className={styles.disclaimer} aria-label="About this listing data">
      <Info size={13} className={styles.icon} aria-hidden />
      <dl className={styles.categories}>
        {categories.map((key) => (
          <div className={styles.category} key={key}>
            <dt className={styles.categoryLabel}>{CATEGORIES[key].label}</dt>
            <dd className={styles.categoryText}>{CATEGORIES[key].text}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
