'use client'

import { useCallback, useEffect, useState } from 'react'
import { RelativeTimestamp } from '@/lib/relative-time'
import { OpsStatusChip } from '@/components/OpsStatusChip'
import styles from '../../ops.module.css'
import {
  formatRunCount,
  jobRunStatusLabel,
  jobRunStatusVariant,
  type JobRunNode,
} from './source-job-run-helpers'

interface JobRunsResponse {
  source: { id: string; name: string }
  generatedAt: string
  runs: JobRunNode[]
}

interface SourceJobRunsSectionProps {
  apiBaseUrl: string
  sourceId: string
}

const REFRESH_MS = 15_000

/**
 * #937: renders the source's full pipeline run tree from
 * `GET /admin/sources/:id/job-runs` (#933 lineage backbone) — job type,
 * status, timestamps, succeeded/failed counts, and (for a failed run) its
 * error message, nested by `parentRunId`. Deliberately a plain page
 * section, not the `Workspace`/docked-terminal panel treatment tracked
 * separately in #934.
 */
export function SourceJobRunsSection({ apiBaseUrl, sourceId }: SourceJobRunsSectionProps) {
  const [runs, setRuns] = useState<JobRunNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sources/${encodeURIComponent(sourceId)}/job-runs`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: JobRunsResponse }
      setRuns(body.data.runs)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job runs')
    }
  }, [apiBaseUrl, sourceId])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  return (
    <section className={styles.sectionBlock} aria-labelledby="source-runs-heading">
      <h2 id="source-runs-heading" className={styles.heading} style={{ fontSize: '1.25rem' }}>
        Runs
      </h2>
      <p className={styles.sectionIntro}>
        Recent job executions for this source, nested by the run that spawned them.
      </p>
      {error ? (
        <p className={styles.error}>Job runs could not load: {error}. Check the API, then refresh this page.</p>
      ) : !runs ? (
        <p className={styles.empty}>Loading job runs…</p>
      ) : runs.length === 0 ? (
        <p className={styles.emptyCompact}>No job runs recorded for this source yet.</p>
      ) : (
        <ul className={styles.runTree}>
          {runs.map((run) => (
            <JobRunItem key={run.id} run={run} />
          ))}
        </ul>
      )}
    </section>
  )
}

function JobRunItem({ run }: { run: JobRunNode }) {
  return (
    <li className={styles.runNode}>
      <div className={styles.runNodeCard}>
        <div className={styles.runNodeHeader}>
          <span className={styles.runNodeType}>{run.jobType}</span>
          <OpsStatusChip label={jobRunStatusLabel(run.status)} variant={jobRunStatusVariant(run.status)} />
        </div>
        <div className={styles.runNodeMeta}>
          <span>
            Started <RelativeTimestamp value={run.startedAt} />
          </span>
          <span>
            Finished <RelativeTimestamp value={run.finishedAt} fallback="—" />
          </span>
          <span>Succeeded {formatRunCount(run.succeededCount)}</span>
          <span>Failed {formatRunCount(run.failedCount)}</span>
        </div>
        {run.status === 'failed' && run.errorMessage && (
          <p className={styles.errorMsg} role="alert">
            {run.errorMessage}
          </p>
        )}
      </div>
      {run.children.length > 0 && (
        <ul className={styles.runNodeChildren}>
          {run.children.map((child) => (
            <JobRunItem key={child.id} run={child} />
          ))}
        </ul>
      )}
    </li>
  )
}
