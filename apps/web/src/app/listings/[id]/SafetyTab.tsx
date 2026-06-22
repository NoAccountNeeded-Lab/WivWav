import { AlertTriangle } from 'lucide-react'
import { RecallsList } from '@/components/listing/RecallsList'
import { SafetyRatings } from '@/components/listing/SafetyRatings'
import { formatFreshnessDate, isSafetyDataStale } from './safetyTabUtils'
import { SafetyRefreshButton } from './SafetyRefreshButton'
import type { ListingDetail, SafetyData } from './types'
import styles from './tabs.module.css'

interface SafetyTabProps {
  listing: ListingDetail
  safety: SafetyData | null
  apiBaseUrl: string
}

export function SafetyTab({ listing, safety, apiBaseUrl }: SafetyTabProps) {
  const openRecallCount = (safety?.recalls ?? []).filter((r) => r.status === 'open').length

  const rating = safety?.safetyRatings?.[0]
  const freshnessDate = safety?.safetyFreshnessDate ?? null
  const formattedDate = formatFreshnessDate(freshnessDate)
  const isStale = isSafetyDataStale(freshnessDate)

  return (
    <div className={styles.tabContent}>
      {/* Freshness banner */}
      {safety !== null && (
        <div className={styles.freshnessBanner} role="note">
          {formattedDate !== null ? (
            <>
              <span>Safety data as of {formattedDate}</span>
              {isStale && (
                <span className={styles.staleWarning}>
                  <AlertTriangle size={12} aria-hidden />
                  {' '}Data may be outdated
                </span>
              )}
            </>
          ) : (
            <span className={styles.staleWarning}>
              <AlertTriangle size={12} aria-hidden />
              {' '}Safety data freshness unknown — verify with NHTSA
            </span>
          )}
          {(isStale || formattedDate === null) && (
            <SafetyRefreshButton listingId={listing.id} apiBaseUrl={apiBaseUrl} />
          )}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionLabelRow}>
          <AlertTriangle size={12} aria-hidden />
          Recalls &amp; VIN history
          {openRecallCount > 0 && (
            <span
              className={styles.recallBadge}
              role="status"
              aria-label={`${openRecallCount} open recall${openRecallCount > 1 ? 's' : ''}`}
            >
              {openRecallCount} open
            </span>
          )}
        </div>
        <RecallsList vin={listing.vin} safety={safety} />
      </div>

      {rating != null && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>NHTSA safety ratings</div>
          <SafetyRatings rating={rating} />
        </div>
      )}

      {rating == null && safety !== null && (
        <p className={styles.placeholder}>
          No NHTSA safety ratings available for this vehicle yet.
        </p>
      )}
    </div>
  )
}
