'use client'

import Link from 'next/link'
import styles from '../ops.module.css'
import { ACTION_ICONS } from '../action-icons'
import type { ReadinessCheck, ReadinessReport, ReadinessStatus } from './readiness-model'
import { useReadinessReport } from './use-readiness-report'

interface ReadinessClientProps {
  apiBaseUrl: string
}

export function ReadinessClient({ apiBaseUrl }: ReadinessClientProps) {
  const { report, updatedAt, isRefreshing, refresh } = useReadinessReport(apiBaseUrl)

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Site readiness</h1>
            <p className={styles.pageIntro}>Launch and handoff checklist for core services, inventory, search, queues, schedules, and scraper activity.</p>
          </div>
          <Link href="/ops" className={styles.backLink}>← Operations</Link>
        </div>

        <div className={styles.controlsBar}>
          <span className={styles.refreshMeta} aria-live="polite">
            {updatedAt ? `Updated ${fmtTime(updatedAt)}` : 'Loading readiness checks…'}
          </span>
          <div className={styles.controlsBarRight}>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => void refresh()} disabled={isRefreshing}>
              <ACTION_ICONS.refresh size={13} aria-hidden="true" />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {!report ? (
          <p className={styles.empty}>Loading readiness checks…</p>
        ) : (
          <>
            <ReadinessSummary report={report} />
            <div className={styles.readinessList} role="list" aria-label="Site readiness checks">
              {report.checks.map(check => (
                <ReadinessItem key={check.id} check={check} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function ReadinessSummary({ report }: { report: ReadinessReport }) {
  return (
    <section className={styles.readinessSummary} aria-labelledby="readiness-summary-heading" data-status={report.overallStatus}>
      <div>
        <h2 id="readiness-summary-heading" className={styles.readinessSummaryTitle}>
          {overallLabel(report.overallStatus)}
        </h2>
        <p className={styles.readinessSummaryText}>{overallText(report)}</p>
      </div>
      <div className={styles.readinessTotals} aria-label="Readiness status totals">
        {(['pass', 'warn', 'fail', 'unavailable'] as ReadinessStatus[]).map(status => (
          <span key={status} className={styles.readinessTotal}>
            <strong>{report.totals[status]}</strong> {status}
          </span>
        ))}
      </div>
    </section>
  )
}

function ReadinessItem({ check }: { check: ReadinessCheck }) {
  return (
    <article className={styles.readinessItem} data-status={check.status} role="listitem">
      <div className={styles.readinessItemHeader}>
        <h3 className={styles.readinessItemTitle}>{check.title}</h3>
        <span className={styles.badge} data-variant={badgeVariant(check.status)}>
          {statusLabel(check.status)}
        </span>
      </div>
      <p className={styles.readinessSummaryLine}>{check.summary}</p>
      <p className={styles.readinessRemediation}>{check.remediation}</p>
      <Link href={check.href} className={styles.readinessAction} aria-label={`Open ${check.title} workflow`}>
        Open workflow
      </Link>
    </article>
  )
}

function badgeVariant(status: ReadinessStatus): string {
  if (status === 'pass') return 'success'
  if (status === 'warn') return 'warning'
  if (status === 'fail') return 'danger'
  return 'neutral'
}

function statusLabel(status: ReadinessStatus): string {
  if (status === 'pass') return 'Pass'
  if (status === 'warn') return 'Warn'
  if (status === 'fail') return 'Fail'
  return 'Unavailable'
}

function overallLabel(status: ReadinessStatus): string {
  if (status === 'pass') return 'Ready for users'
  if (status === 'warn') return 'Ready with warnings'
  if (status === 'fail') return 'Not ready'
  return 'Readiness unknown'
}

function overallText(report: ReadinessReport): string {
  if (report.overallStatus === 'pass') return 'All required readiness checks are passing.'
  if (report.overallStatus === 'fail') return 'Resolve failing checks before launch, deploy handoff, or user-facing validation.'
  if (report.overallStatus === 'unavailable') return 'Some checks could not load data. Verify the linked ops pages before relying on this status.'
  return 'Review warnings and decide whether they are acceptable for the current handoff.'
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}
