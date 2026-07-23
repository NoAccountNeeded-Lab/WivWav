'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bug } from 'lucide-react'
import type { ProblemState } from '@wivwav/types'
import { EntityList, EntityListRow, EntityMetaItem } from '@/components/EntityListRow'
import { OpsStatusChip, type OpsStatusVariant } from '@/components/OpsStatusChip'
import { RelativeTimestamp } from '@/lib/relative-time'
import { ACTION_ICONS } from '../action-icons'
import styles from '../ops.module.css'
import { useOverviewResources } from '../use-overview-resources'
import { useProblemAggregate } from '../use-problem-aggregate'
import { isAcknowledged, presentProblem, sortProblems } from '../problem-presentation'

interface ProblemsClientProps {
  apiBaseUrl: string
}

interface AckState {
  loading: boolean
  feedback: string | null
  isError: boolean
}

function severityVariant(severity: string): OpsStatusVariant {
  if (severity === 'critical') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'neutral'
}

function sourceLabel(source: ProblemState['source']): string {
  if (source === 'domain') return 'WivWav'
  if (source === 'grafana') return 'Grafana'
  return 'Sentry'
}

export function ProblemsClient({ apiBaseUrl }: ProblemsClientProps) {
  const overviewResources = useOverviewResources(apiBaseUrl)
  // The exact same call the overview's Attention panel renders its
  // count + top-N preview from (issue #892) — this page just renders the
  // full list rather than a preview, with no separate computation.
  const problemAggregate = useProblemAggregate(apiBaseUrl, overviewResources)

  const [showAcknowledged, setShowAcknowledged] = useState(false)
  const [ackStates, setAckStates] = useState<Record<string, AckState>>({})

  const problems = problemAggregate.data?.problems ?? []
  const visibleProblems = useMemo(
    () => sortProblems(showAcknowledged ? problems : problems.filter(problem => !isAcknowledged(problem))),
    [problems, showAcknowledged],
  )
  const acknowledgedCount = problems.filter(isAcknowledged).length

  const presentationContext = useMemo(
    () => ({ health: overviewResources.health.data, sources: overviewResources.sources.data }),
    [overviewResources.health.data, overviewResources.sources.data],
  )

  const setAcknowledged = useCallback(async (problem: ProblemState, acknowledged: boolean) => {
    setAckStates(prev => ({ ...prev, [problem.fingerprint]: { loading: true, feedback: null, isError: false } }))
    try {
      const res = await fetch(`${apiBaseUrl}/internal/ops/problem-ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fingerprint: problem.fingerprint, acknowledged }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const body = (await res.json()) as { data: { acknowledgedAt: string | null; acknowledgedBy: string | null } }

      // Optimistically merge the persisted ack state into the already-loaded
      // aggregate rather than re-fetching — removes the problem from (or
      // restores it to) the default view immediately without discarding its
      // history (issue #892's acceptance criterion).
      problemAggregate.setData(prev => prev
        ? { ...prev, problems: prev.problems.map(p => (p.fingerprint === problem.fingerprint ? { ...p, ...body.data } : p)) }
        : prev)

      setAckStates(prev => ({
        ...prev,
        [problem.fingerprint]: { loading: false, feedback: acknowledged ? 'Acknowledged' : 'Unacknowledged', isError: false },
      }))
    } catch (err) {
      setAckStates(prev => ({
        ...prev,
        [problem.fingerprint]: { loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true },
      }))
    }
  }, [apiBaseUrl, problemAggregate])

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Problems</h1>
            <p className={styles.pageIntro}>
              Every active problem across services, sources, queues, schedules, Grafana alerts, and Sentry issues — federated
              from the same aggregate the overview&apos;s Attention panel previews.
            </p>
          </div>
          <Link href="/ops" className={styles.backLink}>← Operations</Link>
        </div>

        <div className={styles.controlsBar}>
          <div className={styles.filterGroup} role="group" aria-label="Filter by acknowledgement">
            <button
              type="button"
              className={styles.filterPill}
              data-active={!showAcknowledged ? 'true' : 'false'}
              aria-pressed={!showAcknowledged}
              onClick={() => setShowAcknowledged(false)}
            >
              Active ({problems.length - acknowledgedCount})
            </button>
            <button
              type="button"
              className={styles.filterPill}
              data-active={showAcknowledged ? 'true' : 'false'}
              aria-pressed={showAcknowledged}
              onClick={() => setShowAcknowledged(true)}
            >
              All, incl. acknowledged ({problems.length})
            </button>
          </div>
          <div className={styles.controlsBarRight}>
            <span className={styles.refreshMeta}>
              {problemAggregate.updatedAt ? `Updated ${formatTime(problemAggregate.updatedAt)}` : 'Loading…'}
            </span>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              type="button"
              onClick={() => void problemAggregate.retry()}
              disabled={problemAggregate.isRefreshing}
            >
              <ACTION_ICONS.refresh size={13} aria-hidden="true" />
              {problemAggregate.isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {problemAggregate.error ? (
          <p className={styles.error}>Problems could not load: {problemAggregate.error}. Check the API, then refresh this page.</p>
        ) : !problemAggregate.data ? (
          <p className={styles.empty}>Loading problems. If this does not finish, confirm the API is running and refresh.</p>
        ) : visibleProblems.length === 0 ? (
          <p className={styles.empty}>
            {showAcknowledged ? 'No problems have ever been recorded.' : 'No active problems — everything currently observable is healthy.'}
          </p>
        ) : (
          <EntityList ariaLabel="Active problems">
            {visibleProblems.map(problem => {
              const presentation = presentProblem(problem, presentationContext)
              const ack = ackStates[problem.fingerprint]
              const acknowledged = isAcknowledged(problem)

              return (
                <EntityListRow
                  key={problem.fingerprint}
                  icon={<Bug size={18} />}
                  title={presentation.title}
                  href={presentation.href}
                  ariaLabel={`${presentation.title}, severity ${problem.severity}, source ${sourceLabel(problem.source)}${acknowledged ? ', acknowledged' : ''}`}
                  status={<OpsStatusChip label={problem.severity} variant={severityVariant(problem.severity)} />}
                  dimmed={acknowledged}
                  secondary={presentation.detail !== presentation.title ? presentation.detail : undefined}
                  meta={(
                    <>
                      <EntityMetaItem>{sourceLabel(problem.source)}</EntityMetaItem>
                      <EntityMetaItem>First seen <RelativeTimestamp value={problem.firstSeen} fallback="unknown" /></EntityMetaItem>
                      <EntityMetaItem>Last seen <RelativeTimestamp value={problem.lastSeen} fallback="unknown" /></EntityMetaItem>
                      {problem.occurrenceCount != null && (
                        <EntityMetaItem emphasis>{problem.occurrenceCount} occurrence{problem.occurrenceCount === 1 ? '' : 's'}</EntityMetaItem>
                      )}
                      {acknowledged && problem.acknowledgedBy && (
                        <EntityMetaItem>Acknowledged by {problem.acknowledgedBy}</EntityMetaItem>
                      )}
                    </>
                  )}
                  actions={(
                    <button
                      className={`${styles.btn} ${styles.btnGhost}`}
                      type="button"
                      disabled={ack?.loading}
                      onClick={() => void setAcknowledged(problem, !acknowledged)}
                      aria-label={`${acknowledged ? 'Unacknowledge' : 'Acknowledge'} ${presentation.title}`}
                    >
                      {acknowledged
                        ? <ACTION_ICONS.disable size={14} aria-hidden="true" />
                        : <ACTION_ICONS.enable size={14} aria-hidden="true" />}
                      {ack?.loading ? 'Saving…' : acknowledged ? 'Unacknowledge' : 'Acknowledge'}
                    </button>
                  )}
                  feedback={ack?.feedback ?? undefined}
                  feedbackIsError={Boolean(ack?.isError)}
                />
              )
            })}
          </EntityList>
        )}
      </div>
    </main>
  )
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date)
}
