import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { safetyStatusSummary } from '@/app/[locale]/listings/[id]/safetyTabUtils'
import styles from './SafetyStatusBadge.module.css'

interface SafetyStatusBadgeProps {
  openRecallCount: number
  overallRating: number | null
}

const LEVEL_CLASS = {
  good: styles.good,
  caution: styles.caution,
  alert: styles.alert,
} as const

/**
 * Single at-a-glance recall/rating status indicator shown above the detailed
 * recall and complaint lists on the Safety tab — the headline fact a buyer
 * should see before scanning the denser detail underneath.
 */
export function SafetyStatusBadge({ openRecallCount, overallRating }: SafetyStatusBadgeProps) {
  const { level, label } = safetyStatusSummary(openRecallCount, overallRating)
  const Icon = level === 'alert' ? ShieldAlert : ShieldCheck

  return (
    <div className={`${styles.badge} ${LEVEL_CLASS[level]}`} role="status">
      <Icon size={16} aria-hidden />
      <span>{label}</span>
    </div>
  )
}
