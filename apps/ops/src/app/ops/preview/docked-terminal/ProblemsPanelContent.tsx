'use client'

import { useMemo } from 'react'
import type { OverviewResources } from '../../use-overview-resources'
import { useProblemAggregate } from '../../use-problem-aggregate'
import { isAcknowledged, presentProblem, problemSourceId, sortProblems } from '../../problem-presentation'
import styles from './docked-terminal.module.css'

interface ProblemsPanelContentProps {
  apiBaseUrl: string
  overviewResources: OverviewResources
  /** Opens/focuses the `source` panel for a source-scoped problem, leaving
   *  this `problems` panel open (#913's entity-relationship-link AC). */
  onOpenSource: (sourceId: string) => void
}

function severityVariant(severity: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (severity === 'critical') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'neutral'
}

/** Problems panel content — the same federated aggregate `/ops/problems`
 *  renders (#913), condensed for a docked pane. */
export function ProblemsPanelContent({ apiBaseUrl, overviewResources, onOpenSource }: ProblemsPanelContentProps) {
  const problemAggregate = useProblemAggregate(apiBaseUrl, overviewResources)
  const problems = problemAggregate.data?.problems ?? []
  const visibleProblems = useMemo(() => sortProblems(problems.filter(problem => !isAcknowledged(problem))), [problems])
  const presentationContext = useMemo(
    () => ({ health: overviewResources.health.data, sources: overviewResources.sources.data }),
    [overviewResources.health.data, overviewResources.sources.data],
  )

  return (
    <div className={styles.panelBody}>
      <div className={styles.panelMetaRow}>
        <span aria-live="polite">
          {problemAggregate.updatedAt ? `Updated ${fmtTime(problemAggregate.updatedAt)}` : 'Loading…'}
        </span>
        <button type="button" className={styles.refreshButton} onClick={() => void problemAggregate.retry()} disabled={problemAggregate.isRefreshing}>
          {problemAggregate.isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {problemAggregate.error ? (
        <p className={styles.errorText}>Problems could not load: {problemAggregate.error}.</p>
      ) : !problemAggregate.data ? (
        <p className={styles.muted}>Loading problems…</p>
      ) : visibleProblems.length === 0 ? (
        <p className={styles.muted}>No active problems.</p>
      ) : (
        <ul className={styles.compactList} aria-label="Active problems">
          {visibleProblems.map(problem => {
            const presentation = presentProblem(problem, presentationContext)
            const sourceId = problemSourceId(problem)
            return (
              <li key={problem.fingerprint} className={styles.compactRow}>
                <span className={styles.compactBadge} data-variant={severityVariant(problem.severity)}>{problem.severity}</span>
                <span className={styles.compactTitle}>{presentation.title}</span>
                {sourceId && (
                  <button
                    type="button"
                    className={styles.inlineLinkButton}
                    onClick={() => onOpenSource(sourceId)}
                  >
                    View source
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date)
}
