import { CheckCircle2, CircleHelp, Clock3, XCircle } from 'lucide-react'
import { recoveryStateLabel, type RecoveryState, type RecoveryVerdict } from './recovery'
import styles from './helm-sections.module.css'

const ICON: Record<RecoveryState, typeof CheckCircle2> = {
  'pending-job': Clock3,
  'waiting-evidence': Clock3,
  recovered: CheckCircle2,
  'not-recovered': XCircle,
  unavailable: CircleHelp,
  'no-claim': CircleHelp,
}

/** Recovery verdict with its evidence lines; the state is always spelled out in words. */
export function RecoveryBadge({ verdict }: { verdict: RecoveryVerdict }) {
  const Icon = ICON[verdict.state]
  const tone = verdict.state === 'recovered' ? undefined : verdict.state === 'not-recovered' ? 'danger' : 'warning'
  return (
    <div className={styles.notice} data-tone={tone} data-recovery-state={verdict.state}>
      <Icon size={16} aria-hidden="true" />
      <div>
        <strong>{recoveryStateLabel(verdict.state)}.</strong> {verdict.headline}
        {verdict.reasons.length > 0 && (
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
            {verdict.reasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}
