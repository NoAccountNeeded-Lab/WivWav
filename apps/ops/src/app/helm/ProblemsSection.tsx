'use client'

import { useMemo, useState } from 'react'
import { problemSourceId, sortProblems, isAcknowledged } from '../ops/problem-presentation'
import { FreshnessChip, Notice } from './primitives'
import { briefProblem } from './problem-impact'
import { SeverityMark } from './severity'
import { useHelm } from './helm-context'
import styles from './helm-sections.module.css'

export function ProblemsSection() {
  const { data, nav } = useHelm()
  const [showAcknowledged, setShowAcknowledged] = useState(false)
  const aggregate = data.problems.data
  const context = useMemo(
    () => ({ health: data.resources.health.data, sources: data.resources.sources.data }),
    [data.resources.health.data, data.resources.sources.data],
  )
  const all = useMemo(() => sortProblems(aggregate?.problems ?? []), [aggregate])
  const visible = showAcknowledged ? all : all.filter(problem => !isAcknowledged(problem))
  const hiddenCount = all.length - visible.length
  const unavailableSignals = aggregate
    ? Object.entries(aggregate.availability).filter(([, state]) => state === 'unavailable').map(([signal]) => signal)
    : []
  const selectedProblem = nav.location.selection.problem

  return (
    <>
      <div className={styles.sectionHeader}>
        <FreshnessChip freshness={data.freshness.problems} />
      </div>
      {aggregate === null ? (
        <Notice tone="warning">
          Problems are unavailable{data.problems.error ? ` (${data.problems.error})` : ''}. This is not the same as no problems.
        </Notice>
      ) : (
        <>
          {data.freshness.problems === 'stale' && (
            <Notice tone="warning">Showing the last successful problem list. The latest refresh failed or is overdue.</Notice>
          )}
          {unavailableSignals.length > 0 && (
            <Notice tone="warning">
              Unavailable problem signals: {unavailableSignals.join(', ')}. Problems from these may be missing, so an empty list is not proof everything is fine.
            </Notice>
          )}
          <label className={styles.toggleRow}>
            <input type="checkbox" checked={showAcknowledged} onChange={event => setShowAcknowledged(event.target.checked)} />
            Show reviewed (acknowledged) problems{hiddenCount > 0 && !showAcknowledged ? ` (${hiddenCount} hidden)` : ''}
          </label>
          {visible.length === 0 ? (
            <p className={styles.empty}>
              {unavailableSignals.length > 0 ? 'No problems reported by the available signals.' : 'No open problems reported.'}
            </p>
          ) : (
            <ul className={styles.rowList} aria-label="Problems">
              {visible.map(problem => {
                const brief = briefProblem(problem, context)
                const sourceId = problemSourceId(problem)
                return (
                  <li key={problem.fingerprint} className={styles.row} data-severity={problem.severity} data-selected={selectedProblem === problem.fingerprint ? 'true' : undefined}>
                    <h3 className={styles.rowTitle}>
                      <SeverityMark severity={problem.severity} />
                      <span>{brief.presentation.title}</span>
                      {isAcknowledged(problem) && <span>(reviewed)</span>}
                    </h3>
                    <p className={styles.rowFacts}>
                      <span>{brief.summary}</span>
                      <span><strong>Affected:</strong> {brief.scope.label}</span>
                      <span><strong>Next:</strong> {brief.nextAction}</span>
                    </p>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.rowButton}
                        aria-label={`Inspect ${brief.presentation.title}`}
                        onClick={() => nav.openProblem(problem.fingerprint, sourceId)}
                      >
                        Inspect
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </>
  )
}
