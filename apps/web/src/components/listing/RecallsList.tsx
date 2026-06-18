import { AlertTriangle, Check, HelpCircle } from 'lucide-react'
import { formatDate } from '@/app/listings/[id]/utils'
import { recallStatusLabel } from '@/app/listings/[id]/safetyTabUtils'
import type { Recall, SafetyData } from '@/app/listings/[id]/types'
import styles from './RecallsList.module.css'

interface RecallsListProps {
  vin: string | null
  safety: SafetyData | null
}

export function RecallsList({ vin, safety }: RecallsListProps) {
  const openRecalls = (safety?.recalls ?? []).filter((r) => r.status === 'open')

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
      ) : openRecalls.length === 0 ? (
        <div className={styles.noRecalls}>
          <Check size={14} aria-hidden />
          No open recalls found for {safety.vehicleModel.year} {safety.vehicleModel.make}{' '}
          {safety.vehicleModel.model}
        </div>
      ) : (
        <ul className={styles.list} aria-label="Recall campaigns">
          {safety.recalls.map((recall) => (
            <RecallItem key={recall.id} recall={recall} />
          ))}
        </ul>
      )}
    </div>
  )
}

function RecallItem({ recall }: { recall: Recall }) {
  const { status } = recall
  const isOpen = status === 'open'
  const isUnknown = status === 'unknown'

  const statusClass = isOpen ? styles.statusOpen : isUnknown ? styles.statusUnknown : styles.statusDone
  const iconClass = isOpen ? styles.iconWarn : isUnknown ? styles.iconUnknown : styles.iconOk
  const Icon = isOpen ? AlertTriangle : isUnknown ? HelpCircle : Check

  return (
    <li className={styles.item}>
      <div className={iconClass} aria-hidden>
        <Icon size={14} />
      </div>
      <div>
        <div className={styles.title}>
          NHTSA #{recall.nhtsaCampaignId} · {recall.component}
        </div>
        <div className={styles.sub}>Issued {formatDate(recall.reportedAt)}</div>
        {recall.summary && <div className={styles.sub}>{recall.summary}</div>}
        <span className={statusClass}>
          {recallStatusLabel(status)}
        </span>
      </div>
    </li>
  )
}
