'use client'

import { OpsStatusChip } from '@/components/OpsStatusChip'
import { Notice } from './primitives'
import { useHelm } from './helm-context'
import { unacknowledgedProblems } from '../ops/problem-presentation'
import styles from './helm-sections.module.css'
import shell from './helm-shell.module.css'

const LEVEL_VARIANT = { critical: 'danger', warning: 'warning', unknown: 'muted', healthy: 'success' } as const

/** Overall status. "Healthy" only appears when nothing is missing, stale or unavailable. */
export function OverviewSection() {
  const { data } = useHelm()
  const { status } = data
  const open = unacknowledgedProblems(data.problems.data?.problems ?? [])
  const queues = data.resources.queues.data
  const backlog = queues ? queues.reduce((sum, queue) => sum + queue.stats.waiting + queue.stats.active + queue.stats.delayed, 0) : null
  return (
    <div className={shell.statusBanner} data-level={status.level}>
      <p className={shell.statusHeadline} role="status">
        <OpsStatusChip variant={LEVEL_VARIANT[status.level]} label={status.level === 'unknown' ? 'Unknown' : status.level === 'healthy' ? 'Healthy' : status.level === 'critical' ? 'Critical' : 'Warning'} />
        {status.label}
      </p>
      {status.reasons.length > 0 && (
        <>
          <Notice tone="warning">
            {status.level === 'unknown'
              ? 'Helm cannot call this healthy: some evidence is missing, stale or unavailable.'
              : 'Some evidence is also missing, stale or unavailable, so more problems may exist.'}
          </Notice>
          <ul className={shell.statusReasons}>
            {status.reasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        </>
      )}
      <ul className={shell.overviewTiles} aria-label="At a glance">
        <li className={styles.card}>
          <h3 className={styles.cardLabel}>Open problems</h3>
          <p className={styles.cardValue} data-unavailable={data.problems.data ? undefined : 'true'}>{data.problems.data ? open.length.toLocaleString() : 'Unavailable'}</p>
        </li>
        <li className={styles.card}>
          <h3 className={styles.cardLabel}>Queue backlog</h3>
          <p className={styles.cardValue} data-unavailable={backlog === null ? 'true' : undefined}>{backlog === null ? 'Unavailable' : backlog.toLocaleString()}</p>
          <p className={styles.cardMeta}>waiting + active + delayed jobs</p>
        </li>
      </ul>
    </div>
  )
}
