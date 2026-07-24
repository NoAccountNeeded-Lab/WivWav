'use client'

import { useCallback, useEffect, useState } from 'react'
import styles from './docked-terminal.module.css'

interface LogEntry {
  ts: string
  level: string | null
  message: string | null
  jobId: string | null
}

interface LogsPanelContentProps {
  apiBaseUrl: string
  jobId: string
}

/** Logs panel content, opened via the `queues` panel's failed-job-count
 *  entity relationship link (#913) — real `/admin/logs` data, filtered to
 *  the job that opened it. */
export function LogsPanelContent({ apiBaseUrl, jobId }: LogsPanelContentProps) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50', search: jobId })
      const res = await fetch(`${apiBaseUrl}/admin/logs?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: LogEntry[] }
      setEntries(body.data.filter(entry => entry.jobId === jobId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs')
    }
  }, [apiBaseUrl, jobId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className={styles.panelBody}>
      <p className={styles.panelMetaRow}>
        <span>Filtered to job <code>{jobId}</code></span>
        <button type="button" className={styles.refreshButton} onClick={() => void refresh()}>Refresh</button>
      </p>
      {error ? (
        <p className={styles.errorText}>Logs could not load: {error}.</p>
      ) : !entries ? (
        <p className={styles.muted}>Loading logs for job {jobId}…</p>
      ) : entries.length === 0 ? (
        <p className={styles.muted}>No log lines found for job {jobId} in the recent window.</p>
      ) : (
        <ul className={styles.compactList} aria-label={`Log lines for job ${jobId}`}>
          {entries.map((entry, index) => (
            <li key={`${entry.ts}-${index}`} className={styles.compactRow}>
              <span className={styles.muted}>{entry.level ?? 'unknown'}</span>
              <span className={styles.compactTitle}>{entry.message ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
