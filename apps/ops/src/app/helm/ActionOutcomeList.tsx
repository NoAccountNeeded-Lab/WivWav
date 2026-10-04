'use client'

import { OpsStatusChip } from '@/components/OpsStatusChip'
import { RecoveryBadge } from './RecoveryBadge'
import { useHelm } from './helm-context'
import { outcomeLabel, type TrackedAction } from './tracked-action'
import styles from './inspector/helm-inspector.module.css'

const OUTCOME_VARIANT = {
  enqueuing: 'neutral', queued: 'neutral', running: 'neutral', completed: 'success', failed: 'danger', unavailable: 'muted',
} as const

/**
 * Outcome of each action the operator started: the request result, the queue
 * job id, the job's queued/running/completed/failed/unavailable state, and —
 * once the job is done — the evidence-based recovery verdict. These live in
 * the workspace-level tracker, so they keep updating when the inspector moves
 * to a different selection.
 */
export function ActionOutcomeList({ actions, label, onOpenSource }: { actions: TrackedAction[]; label: string; onOpenSource?: (sourceId: string) => void }) {
  const { tracker } = useHelm()
  if (actions.length === 0) return null
  return (
    <ul className={styles.list} aria-label={label}>
      {actions.map(action => (
        <li key={action.id} className={styles.listItem} data-action-kind={action.kind}>
          <p className={styles.prose}>
            <strong>{action.label}{action.sourceName ? `: ${action.sourceName}` : ''}</strong>{' '}
            <OpsStatusChip variant={OUTCOME_VARIANT[action.outcome]} label={action.failure ? 'Request rejected' : outcomeLabel(action.outcome)} />
          </p>
          {action.failure ? (
            <p className={styles.reason} role="alert">
              The request was not accepted{action.failure.status ? ` (HTTP ${action.failure.status}${action.failure.code ? ` ${action.failure.code}` : ''})` : ''}: {action.failure.message}. No job was queued.
            </p>
          ) : (
            <p className={styles.reason}>
              {action.jobId ? <>Queue <code>{action.queue}</code>, job <code>{action.jobId}</code>.</> : 'Sending request…'}
              {action.detail && action.outcome !== 'completed' ? ` ${action.detail}` : ''}
              {action.checkError ? ` ${action.checkError}` : ''}
            </p>
          )}
          {action.jobId ? <RecoveryBadge verdict={tracker.verdictFor(action)} /> : null}
          <div className={styles.actionRow}>
            {onOpenSource && action.sourceId && (
              <button type="button" className={styles.actionButton} onClick={() => onOpenSource(action.sourceId as string)}>
                Open {action.sourceName ?? 'source'}
              </button>
            )}
            <button type="button" className={styles.actionButton} onClick={() => tracker.dismiss(action.id)}>
              Dismiss
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
