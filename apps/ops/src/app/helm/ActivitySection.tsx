'use client'

import { useMemo } from 'react'
import { OpsStatusChip } from '@/components/OpsStatusChip'
import { RelativeTimestamp } from '@/lib/relative-time'
import { RunHistory } from './RunHistory'
import { ActionOutcomeList } from './ActionOutcomeList'
import { buildRunHistory } from './run-history-model'
import { FreshnessChip } from './primitives'
import { useHelm } from './helm-context'
import styles from './helm-sections.module.css'

const RECENT_RUN_ROWS = 8

export function ActivitySection() {
  const { data, nav, tracker } = useHelm()
  const runs = data.resources.runs.data
  const history = useMemo(() => buildRunHistory(runs), [runs])
  const recent = useMemo(
    () => [...(runs ?? [])].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, RECENT_RUN_ROWS),
    [runs],
  )

  return (
    <>
      <div className={styles.sectionHeader}>
        <FreshnessChip freshness={data.freshness.runs} />
      </div>
      <RunHistory history={history} error={data.resources.runs.error} onInspectRun={nav.openRun} />

      <div className={styles.chartBlock}>
        <h3 className={styles.chartTitle}>Actions you started</h3>
        {tracker.actions.length === 0 ? (
          <p className={styles.empty}>No actions started in this session. Use the inspector to run a source or rebuild search.</p>
        ) : (
          <ActionOutcomeList actions={tracker.actions} label="Tracked actions" onOpenSource={nav.openSource} />
        )}
      </div>

      <div className={styles.chartBlock}>
        <h3 className={styles.chartTitle}>Latest scrape runs</h3>
        {runs === null ? (
          <p className={styles.empty}>Scrape runs are unavailable{data.resources.runs.error ? ` (${data.resources.runs.error})` : ''}.</p>
        ) : recent.length === 0 ? (
          <p className={styles.empty}>No scrape runs recorded yet.</p>
        ) : (
          <ul className={styles.rowList} aria-label="Latest scrape runs">
            {recent.map(run => (
              <li key={run.id} className={styles.row} data-selected={nav.location.selection.run === `scrape:${run.id}` ? 'true' : undefined}>
                <h4 className={styles.rowTitle}>
                  <span>{run.sourceName ?? run.sourceId}</span>
                  <OpsStatusChip
                    variant={run.success === true ? 'success' : run.success === false ? 'danger' : 'neutral'}
                    label={run.success === true ? 'Succeeded' : run.success === false ? 'Failed' : run.finishedAt === null ? 'Running' : 'Unknown'}
                  />
                </h4>
                <p className={styles.rowFacts}>
                  <span>Started <RelativeTimestamp value={run.startedAt} /> · {run.listingsFound === null ? 'listings found not reported' : `${run.listingsFound.toLocaleString()} listings found`}</span>
                </p>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.rowButton}
                    aria-label={`Inspect run of ${run.sourceName ?? run.sourceId} started ${run.startedAt}`}
                    onClick={() => nav.openRun(`scrape:${run.id}`, run.sourceId)}
                  >
                    Inspect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
