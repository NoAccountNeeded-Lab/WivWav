import { AlertTriangle, Check, HelpCircle } from 'lucide-react'
import { formatDate } from '@/app/[locale]/listings/[id]/utils'
import { recallStatusLabel } from '@/app/[locale]/listings/[id]/safetyTabUtils'
import type { Recall, SafetyData } from '@/app/[locale]/listings/[id]/types'
import styles from './RecallsList.module.css'

interface RecallsListProps {
  vin: string | null
  safety: SafetyData | null
}

/** NHTSA recall detail URL for a given campaign ID. */
function nhtsaRecallUrl(nhtsaCampaignId: string): string {
  return `https://www.nhtsa.gov/recalls?nhtsaId=${nhtsaCampaignId}`
}

export function RecallsList({ vin, safety }: RecallsListProps) {
  const allRecalls = safety?.recalls ?? []
  const openRecalls = allRecalls.filter((r) => r.status === 'open')
  const historicalRecalls = allRecalls.filter((r) => r.status !== 'open')
  // Only reassure "nothing to do" when every closed recall has a confirmed
  // fix — a recall whose remedy is still 'unknown' isn't actually resolved,
  // so it must not be folded into a blanket "no action needed" claim.
  const allHistoricalRemedied = historicalRecalls.every((r) => r.status === 'remedied')

  return (
    <div>
      {vin && (
        <div className={styles.vinRow}>
          <span className={styles.vinKey}>VIN</span>
          <span className={styles.vinVal}>{vin}</span>
        </div>
      )}

      {safety === null || safety.vehicleModel === null ? (
        <p className={styles.placeholder}>
          Safety data not yet available for this vehicle. Check back after the next NHTSA sync.
        </p>
      ) : (
        <>
          {/* Summary counts */}
          <div className={styles.recallSummary}>
            {openRecalls.length === 0 ? (
              <div className={styles.noRecalls}>
                <Check size={14} aria-hidden />
                No open recalls found for {safety.vehicleModel.year} {safety.vehicleModel.make}{' '}
                {safety.vehicleModel.model}
              </div>
            ) : (
              <div className={styles.recallSummaryCounts}>
                <span className={styles.recallCountOpen}>
                  {openRecalls.length} open recall{openRecalls.length !== 1 ? 's' : ''}
                </span>
                {historicalRecalls.length > 0 && (
                  <span className={styles.recallCountHistorical}>
                    {historicalRecalls.length} historical
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Open recalls */}
          {openRecalls.length > 0 && (
            <>
              <div className={styles.recallGroupLabel}>Open recalls</div>
              <ul className={styles.list} aria-label="Open recall campaigns">
                {openRecalls.map((recall) => (
                  <RecallItem key={recall.id} recall={recall} />
                ))}
              </ul>
            </>
          )}

          {/* Historical recalls */}
          {historicalRecalls.length > 0 && (
            <>
              <div className={styles.recallGroupLabel}>
                Closed recalls
                {openRecalls.length === 0 && allHistoricalRemedied && (
                  <span className={styles.recallGroupNote}> — no action needed</span>
                )}
              </div>
              <ul className={styles.list} aria-label="Closed recall campaigns">
                {historicalRecalls.map((recall) => (
                  <RecallItem key={recall.id} recall={recall} />
                ))}
              </ul>
            </>
          )}

          {/* Empty state when no recalls at all */}
          {allRecalls.length === 0 && (
            <p className={styles.placeholder}>
              No recall records found for this vehicle model.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function RecallItem({ recall }: { recall: Recall }) {
  const { status } = recall
  const isOpen = status === 'open'
  const isUnknown = status === 'unknown'

  const statusClass = isOpen ? styles.statusOpen : isUnknown ? styles.statusCaution : styles.statusDone
  const iconClass = isOpen ? styles.iconWarn : isUnknown ? styles.iconCaution : styles.iconOk
  const Icon = isOpen ? AlertTriangle : isUnknown ? HelpCircle : Check

  return (
    <li className={styles.item}>
      <div className={iconClass} aria-hidden>
        <Icon size={14} />
      </div>
      <div>
        <div className={styles.title}>
          <a
            href={nhtsaRecallUrl(recall.nhtsaCampaignId)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.titleLink}
          >
            NHTSA #{recall.nhtsaCampaignId}
            <span className="sr-only"> (opens in new tab)</span>
          </a>
          {' '}· {recall.component}
        </div>
        <div className={styles.sub}>Issued {formatDate(recall.reportedAt)}</div>
        {recall.summary && <div className={styles.sub}>{recall.summary}</div>}
        {recall.remedy && (
          <div className={styles.remedy}>Remedy: {recall.remedy}</div>
        )}
        <div className={styles.recallItemFooter}>
          <span className={statusClass}>
            {recallStatusLabel(status)}
          </span>
        </div>
      </div>
    </li>
  )
}
