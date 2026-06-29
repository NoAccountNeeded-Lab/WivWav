import { AlertTriangle } from 'lucide-react'
import { RecallsList } from '@/components/listing/RecallsList'
import { SafetyRatings } from '@/components/listing/SafetyRatings'
import { formatFreshnessDate, isSafetyDataStale } from './safetyTabUtils'
import { formatDate } from './utils'
import type { Investigation, ListingDetail, ManufacturerCommunication, SafetyData } from './types'
import styles from './tabs.module.css'

interface SafetyTabProps {
  listing: ListingDetail
  safety: SafetyData | null
}

export function SafetyTab({ listing, safety }: SafetyTabProps) {
  const openRecallCount = (safety?.recalls ?? []).filter((r) => r.status === 'open').length

  const rating = safety?.safetyRatings?.[0]
  const freshnessDate = safety?.safetyFreshnessDate ?? null
  const formattedDate = formatFreshnessDate(freshnessDate)
  const isStale = isSafetyDataStale(freshnessDate)

  const investigations = safety?.investigations ?? []
  const manufacturerCommunications = safety?.manufacturerCommunications ?? []
  const complaints = safety?.complaints ?? []

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

      {complaints.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            NHTSA complaints
            <span className={styles.sectionCount}>{complaints.length}</span>
          </div>
          <ul className={styles.safetyItemList} aria-label="NHTSA complaints">
            {complaints.map((complaint) => (
              <li key={complaint.id} className={styles.safetyItem}>
                <div>
                  <div className={styles.safetyItemTitle}>{complaint.component}</div>
                  {complaint.mileage != null && (
                    <div className={styles.safetyItemSub}>
                      At {complaint.mileage.toLocaleString()} miles
                    </div>
                  )}
                  {complaint.summary && (
                    <div className={styles.safetyItemSub}>{complaint.summary}</div>
                  )}
                  <a
                    href={`https://www.nhtsa.gov/vehicle/complaints#${complaint.nhtsaId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.safetyItemSource}
                  >
                    NHTSA complaint #{complaint.nhtsaId}
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {investigations.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>NHTSA investigations</div>
          <ul className={styles.safetyItemList} aria-label="NHTSA investigations">
            {investigations.map((inv) => (
              <InvestigationItem key={inv.id} investigation={inv} />
            ))}
          </ul>
        </div>
      )}

      {manufacturerCommunications.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Technical service bulletins</div>
          <ul className={styles.safetyItemList} aria-label="Technical service bulletins">
            {manufacturerCommunications.map((comm) => (
              <ManufacturerCommunicationItem key={comm.id} communication={comm} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function InvestigationItem({ investigation }: { investigation: Investigation }) {
  const isOpen = investigation.closedDate === null
  return (
    <li className={styles.safetyItem}>
      <div>
        <div className={styles.safetyItemTitle}>
          NHTSA #{investigation.nhtsaId} · {investigation.component}
        </div>
        <div className={styles.safetyItemSub}>
          Opened {formatDate(investigation.openedDate)}
          {isOpen ? (
            <span className={styles.safetyItemBadgeOpen}>Open</span>
          ) : (
            <span className={styles.safetyItemBadgeClosed}>Closed</span>
          )}
        </div>
        {investigation.summary && (
          <div className={styles.safetyItemSub}>{investigation.summary}</div>
        )}
        {investigation.outcome && (
          <div className={styles.safetyItemSub}>Outcome: {investigation.outcome}</div>
        )}
        <a
          href={investigation.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.safetyItemSource}
        >
          NHTSA source
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </div>
    </li>
  )
}

function ManufacturerCommunicationItem({ communication }: { communication: ManufacturerCommunication }) {
  return (
    <li className={styles.safetyItem}>
      <div>
        <div className={styles.safetyItemTitle}>
          TSB #{communication.nhtsaId} · {communication.component}
        </div>
        <div className={styles.safetyItemSub}>Issued {formatDate(communication.issuedDate)}</div>
        {communication.summary && (
          <div className={styles.safetyItemSub}>{communication.summary}</div>
        )}
        <a
          href={communication.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.safetyItemSource}
        >
          NHTSA source
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </div>
    </li>
  )
}
