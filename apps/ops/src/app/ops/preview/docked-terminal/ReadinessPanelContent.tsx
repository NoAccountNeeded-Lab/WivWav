'use client'

import styles from './docked-terminal.module.css'
import { useReadinessReport } from '../../readiness/use-readiness-report'
import type { ReadinessStatus } from '../../readiness/readiness-model'

function badgeVariant(status: ReadinessStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'pass') return 'success'
  if (status === 'warn') return 'warning'
  if (status === 'fail') return 'danger'
  return 'neutral'
}

/** Readiness panel content — same `buildReadinessReport` data
 *  `/ops/readiness` renders, condensed for a docked pane (#913). */
export function ReadinessPanelContent({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { report, updatedAt, isRefreshing, refresh } = useReadinessReport(apiBaseUrl)

  return (
    <div className={styles.panelBody}>
      <div className={styles.panelMetaRow}>
        <span aria-live="polite">{updatedAt ? `Updated ${fmtTime(updatedAt)}` : 'Loading…'}</span>
        <button type="button" className={styles.refreshButton} onClick={() => void refresh()} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!report ? (
        <p className={styles.muted}>Loading readiness checks…</p>
      ) : (
        <ul className={styles.compactList} aria-label="Site readiness checks">
          {report.checks.map(check => (
            <li key={check.id} className={styles.compactRow} data-status={check.status}>
              <span className={styles.compactBadge} data-variant={badgeVariant(check.status)}>{check.status}</span>
              <span className={styles.compactTitle}>{check.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date)
}
