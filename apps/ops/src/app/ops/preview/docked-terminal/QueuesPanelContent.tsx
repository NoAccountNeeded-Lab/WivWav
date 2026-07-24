'use client'

import { useCallback, useEffect, useState } from 'react'
import { WorkspaceResizableSplit } from '@/components/Workspace'
import styles from './docked-terminal.module.css'

interface QueueStats {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

interface QueueRow {
  name: string
  paused: boolean
  stats: QueueStats
}

interface JobRecord {
  id: string
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
}

interface QueueDetail extends QueueRow {
  jobs: JobRecord[]
}

const REFRESH_MS = 15_000

interface QueuesPanelContentProps {
  apiBaseUrl: string
  /** Opens/focuses the `logs` panel filtered to `jobId`, leaving this
   *  `queues` panel open (#913's entity-relationship-link AC). */
  onOpenLogsForJob: (jobId: string) => void
}

/** Queues panel content — the same `/admin/queues` snapshot `/ops/queues`
 *  renders (#913), with a queue-list / queue-detail split matching the
 *  internal split the `queue` demo entity already showed in
 *  `workspace-preview`. */
export function QueuesPanelContent({ apiBaseUrl, onOpenLogsForJob }: QueuesPanelContentProps) {
  const [queues, setQueues] = useState<QueueRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null)
  const [queueDetail, setQueueDetail] = useState<QueueDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/admin/queues`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: QueueRow[] }
      setQueues(body.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queues')
    }
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  const loadQueueDetail = useCallback(async (name: string): Promise<QueueDetail | null> => {
    try {
      const res = await fetch(`${apiBaseUrl}/admin/queues/${encodeURIComponent(name)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: QueueDetail }
      setQueueDetail(body.data)
      setDetailError(null)
      return body.data
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load queue activity')
      return null
    }
  }, [apiBaseUrl])

  useEffect(() => {
    if (!selectedQueue) return
    void loadQueueDetail(selectedQueue)
  }, [selectedQueue, loadQueueDetail])

  const handleFailedClick = useCallback(async (queue: QueueRow) => {
    setSelectedQueue(queue.name)
    const detail = queue.name === queueDetail?.name ? queueDetail : await loadQueueDetail(queue.name)
    const failedJob = detail?.jobs.find(job => job.status === 'failed')
    if (failedJob) onOpenLogsForJob(failedJob.id)
  }, [loadQueueDetail, onOpenLogsForJob, queueDetail])

  return (
    <div className={styles.panelBody}>
      {error ? (
        <p className={styles.errorText}>Queues could not load: {error}.</p>
      ) : !queues ? (
        <p className={styles.muted}>Loading queue diagnostics…</p>
      ) : (
        <WorkspaceResizableSplit
          label="Queue list and detail split"
          first={(
            <ul className={styles.compactList} aria-label="Queue diagnostics rows">
              {queues.map(queue => (
                <li key={queue.name} className={styles.compactRow} data-selected={selectedQueue === queue.name ? 'true' : undefined}>
                  <button type="button" className={styles.inlineLinkButton} onClick={() => setSelectedQueue(queue.name)}>
                    {queue.name}
                  </button>
                  <span className={styles.muted}>{queue.paused ? 'paused' : `${queue.stats.active} active`}</span>
                  {queue.stats.failed > 0 && (
                    <button
                      type="button"
                      className={styles.failedCountButton}
                      aria-label={`${queue.stats.failed} failed jobs in ${queue.name} — view logs for a failed job`}
                      onClick={() => void handleFailedClick(queue)}
                    >
                      {queue.stats.failed} failed
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          second={(
            <div className={styles.queueDetailPane}>
              {!selectedQueue ? (
                <p className={styles.muted}>Select a queue to see recent job activity.</p>
              ) : detailError ? (
                <p className={styles.errorText}>Activity could not load: {detailError}.</p>
              ) : !queueDetail || queueDetail.name !== selectedQueue ? (
                <p className={styles.muted}>Loading {selectedQueue} activity…</p>
              ) : (
                <ul className={styles.compactList} aria-label={`${selectedQueue} recent jobs`}>
                  {queueDetail.jobs.map(job => (
                    <li key={job.id} className={styles.compactRow}>
                      <code>#{job.id}</code>
                      <span className={styles.muted}>{job.status}</span>
                      {job.status === 'failed' && (
                        <button type="button" className={styles.inlineLinkButton} onClick={() => onOpenLogsForJob(job.id)}>
                          View logs
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        />
      )}
    </div>
  )
}
