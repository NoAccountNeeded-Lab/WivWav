'use client'

import type { ProblemState } from '@wivwav/types'
import { OpsStatusChip, type OpsStatusVariant } from '@/components/OpsStatusChip'
import { formatRelativeTimestamp } from '@/lib/relative-time'
import { severityStatusLabel, type OverviewCard, type OverviewSeverity, type QueueRow, type RunRow, type ScheduleEntry } from '../../overview-helpers'
import { presentProblem, sortProblems, unacknowledgedProblems, type ProblemPresentationContext } from '../../problem-presentation'
import type { ReadinessCheck, ReadinessReport } from '../../readiness/readiness-model'
import styles from './panel-content.module.css'

function severityVariant(severity: OverviewSeverity): OpsStatusVariant {
  if (severity === 'good') return 'success'
  if (severity === 'warning') return 'warning'
  if (severity === 'critical') return 'danger'
  return 'neutral'
}

/* ── Service health ───────────────────────────────────────────────────────── */

export function ServiceHealthPanelContent({ cards }: { cards: OverviewCard[] }) {
  if (cards.length === 0) return <p className={styles.empty}>Waiting for health data…</p>
  return (
    <ul className={styles.rows} aria-label="Service health">
      {cards.map(card => (
        <li key={card.id} className={styles.row}>
          <span className={styles.rowLabel}>{card.label}</span>
          <span className={styles.rowDetail}>{card.detail}</span>
          <OpsStatusChip label={severityStatusLabel(card.severity)} variant={severityVariant(card.severity)} />
        </li>
      ))}
    </ul>
  )
}

/* ── Active problems ──────────────────────────────────────────────────────── */

const PROBLEM_SEVERITY_VARIANT: Record<string, OpsStatusVariant> = { critical: 'danger', warning: 'warning' }

export function ActiveProblemsPanelContent({ problems, context }: { problems: ProblemState[] | null; context: ProblemPresentationContext }) {
  if (problems === null) return <p className={styles.empty}>Loading problems…</p>
  const active = sortProblems(unacknowledgedProblems(problems))
  if (active.length === 0) return <p className={styles.empty}>No active problems</p>

  return (
    <ul className={styles.rows} aria-label="Active problems">
      {active.map(problem => {
        const presentation = presentProblem(problem, context)
        return (
          <li key={problem.fingerprint} className={styles.row}>
            <span className={styles.rowLabel}>{presentation.title}</span>
            <span className={styles.rowDetail}>{presentation.detail}</span>
            <OpsStatusChip label={problem.severity} variant={PROBLEM_SEVERITY_VARIANT[problem.severity] ?? 'neutral'} />
          </li>
        )
      })}
    </ul>
  )
}

/* ── Queue depth ──────────────────────────────────────────────────────────── */

export function QueueDepthPanelContent({ queues }: { queues: QueueRow[] | null }) {
  if (queues === null) return <p className={styles.empty}>Loading queues…</p>
  if (queues.length === 0) return <p className={styles.empty}>No queues reported</p>

  return (
    <ul className={styles.table} aria-label="Queue depth">
      {queues.map(queue => (
        <li
          key={queue.name}
          className={styles.tableRow}
          aria-label={`${queue.name}${queue.paused ? ', paused' : ''}, waiting ${queue.stats.waiting}, active ${queue.stats.active}, delayed ${queue.stats.delayed}, failed ${queue.stats.failed}`}
        >
          <span className={styles.tableName} aria-hidden="true">
            {queue.name}
            {queue.paused && <span className={styles.tablePausedBadge}>Paused</span>}
          </span>
          <span className={styles.tableStat} aria-hidden="true">{queue.stats.waiting}w</span>
          <span className={styles.tableStat} aria-hidden="true">{queue.stats.active}a</span>
          <span className={styles.tableStat} aria-hidden="true">{queue.stats.delayed}d</span>
          <span className={styles.tableStat} data-alert={queue.stats.failed > 0} aria-hidden="true">{queue.stats.failed}f</span>
        </li>
      ))}
    </ul>
  )
}

/* ── Recent source runs ───────────────────────────────────────────────────── */

const RECENT_RUNS_LIMIT = 8

export function RecentRunsPanelContent({ runs, now }: { runs: RunRow[] | null; now: Date }) {
  if (runs === null) return <p className={styles.empty}>Loading runs…</p>
  if (runs.length === 0) return <p className={styles.empty}>No runs reported</p>

  const recent = [...runs]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, RECENT_RUNS_LIMIT)

  return (
    <ul className={styles.rows} aria-label="Recent source runs">
      {recent.map(run => (
        <li key={run.id} className={styles.row}>
          <span className={styles.rowLabel}>{run.sourceName ?? run.sourceId}</span>
          <span className={styles.rowDetail}>{formatRelativeTimestamp(run.startedAt, { now }) ?? run.startedAt}</span>
          <OpsStatusChip
            label={run.success === true ? 'Success' : run.success === false ? 'Failed' : 'Running'}
            variant={run.success === true ? 'success' : run.success === false ? 'danger' : 'neutral'}
          />
        </li>
      ))}
    </ul>
  )
}

/* ── Recurring jobs ───────────────────────────────────────────────────────── */

export function RecurringJobsPanelContent({ schedules }: { schedules: ScheduleEntry[] | null }) {
  if (schedules === null) return <p className={styles.empty}>Loading schedules…</p>
  if (schedules.length === 0) return <p className={styles.empty}>No recurring jobs reported</p>

  return (
    <ul className={styles.rows} aria-label="Recurring jobs">
      {schedules.map(schedule => (
        <li key={schedule.id} className={styles.row}>
          <span className={styles.rowLabel}>{schedule.label}</span>
          <span className={styles.rowDetail}>{schedule.queue}</span>
          <OpsStatusChip
            label={!schedule.enabled ? 'Disabled' : schedule.recentFailureCount > 0 ? 'Failing' : 'Enabled'}
            variant={!schedule.enabled ? 'paused' : schedule.recentFailureCount > 0 ? 'danger' : 'success'}
          />
        </li>
      ))}
    </ul>
  )
}

/* ── Site readiness (dense multi-column checklist) ───────────────────────── */

function readinessVariant(status: ReadinessCheck['status']): OpsStatusVariant {
  if (status === 'pass') return 'success'
  if (status === 'warn') return 'warning'
  if (status === 'fail') return 'danger'
  return 'neutral'
}

export function ReadinessChecklistPanelContent({ report }: { report: ReadinessReport | null }) {
  if (report === null) return <p className={styles.empty}>Loading readiness checks…</p>

  return (
    <div className={styles.checklist} role="list" aria-label="Site readiness checklist">
      {report.checks.map(check => (
        <div key={check.id} className={styles.checklistItem} data-status={check.status} role="listitem">
          <span className={styles.checklistTitle}>{check.title}</span>
          <OpsStatusChip label={check.status} variant={readinessVariant(check.status)} />
        </div>
      ))}
    </div>
  )
}
