import { Info } from 'lucide-react'
import styles from './ListingDisclaimer.module.css'

/**
 * Aggregator disclaimer displayed near decision-impacting listing data.
 * Explains that WivWav aggregates listings and is not the seller or
 * the source of truth — users should verify with the original source.
 *
 * The four distinguishable data categories (per AC) are each labelled separately:
 *   1. Seller-provided listing data
 *   2. Safety ratings (NHTSA)
 *   3. Recall data (NHTSA)
 *   4. Market pricing (WivWav index)
 */
export function ListingDisclaimer() {
  return (
    <div role="note" className={styles.disclaimer} aria-label="About this listing data">
      <Info size={13} className={styles.icon} aria-hidden />
      <dl className={styles.categories}>
        <div className={styles.category}>
          <dt className={styles.categoryLabel}>Listing data</dt>
          <dd className={styles.categoryText}>
            Price, availability, and all seller-provided details come from the original source and
            may change. Verify with the seller before making decisions.
          </dd>
        </div>
        <div className={styles.category}>
          <dt className={styles.categoryLabel}>Safety ratings &amp; recalls</dt>
          <dd className={styles.categoryText}>Sourced from NHTSA. Not provided by the seller.</dd>
        </div>
        <div className={styles.category}>
          <dt className={styles.categoryLabel}>Market pricing</dt>
          <dd className={styles.categoryText}>
            Reflects WivWav index data only and may not represent current market conditions.
          </dd>
        </div>
      </dl>
    </div>
  )
}
