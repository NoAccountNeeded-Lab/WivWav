'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { RelativeTimestamp } from '@/lib/relative-time'
import styles from '../ops.module.css'
import workerStyles from './WorkersClient.module.css'
import { ACTION_ICONS } from '../action-icons'

interface InFlightJob {
  queueName: string
  correlationId: string
  dispatchedAt: string
}

interface RecentJob {
  queueName: string
  correlationId: string
  success: boolean
  escalated?: boolean
  errorMessage?: string
  finishedAt: string
}

interface ConnectedWorker {
  workerId: string
  workerName: string
  capabilities: {
    chromium: boolean
    httpEnrich: boolean
    maxConcurrentJobs: number
  }
  inFlightCount: number
  inFlightJobs: InFlightJob[]
  recentJobs: RecentJob[]
  lastHeartbeatAt: string
}

interface WorkersClientProps {
  apiBaseUrl: string
}

const REFRESH_MS = 15_000

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInFlightJob(row: unknown): row is InFlightJob {
  if (!isRecord(row)) return false
  return (
    typeof row.queueName === 'string' &&
    typeof row.correlationId === 'string' &&
    typeof row.dispatchedAt === 'string'
  )
}

function isRecentJob(row: unknown): row is RecentJob {
  if (!isRecord(row)) return false
  return (
    typeof row.queueName === 'string' &&
    typeof row.correlationId === 'string' &&
    typeof row.success === 'boolean' &&
    (row.escalated === undefined || typeof row.escalated === 'boolean') &&
    (row.errorMessage === undefined || typeof row.errorMessage === 'string') &&
    typeof row.finishedAt === 'string'
  )
}

function isConnectedWorker(row: unknown): row is ConnectedWorker {
  if (!isRecord(row) || !isRecord(row.capabilities)) return false
  return (
    typeof row.workerId === 'string' &&
    typeof row.workerName === 'string' &&
    typeof row.inFlightCount === 'number' &&
    Array.isArray(row.inFlightJobs) &&
    (row.inFlightJobs as unknown[]).every(isInFlightJob) &&
    Array.isArray(row.recentJobs) &&
    (row.recentJobs as unknown[]).every(isRecentJob) &&
    typeof row.lastHeartbeatAt === 'string' &&
    typeof row.capabilities.chromium === 'boolean' &&
    typeof row.capabilities.httpEnrich === 'boolean' &&
    typeof row.capabilities.maxConcurrentJobs === 'number'
  )
}

function parseWorkers(body: unknown): ConnectedWorker[] {
  if (!isRecord(body) || !Array.isArray(body.data) || !body.data.every(isConnectedWorker)) {
    throw new Error('API returned an unexpected response')
  }
  return body.data
}

export function WorkersClient({ apiBaseUrl }: WorkersClientProps) {
  const [workers, setWorkers] = useState<ConnectedWorker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set())

  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const requestSeq = useRef(0)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current
    // Drops a response that was superseded by a newer request or arrived after unmount.
    const isStale = () => !mounted.current || seq !== requestSeq.current
    setIsRefreshing(true)
    try {
      const res = await fetch(`${apiBaseUrl}/admin/workers`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const rows = parseWorkers(await res.json())
      if (isStale()) return
      setWorkers(rows)
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      if (isStale()) return
      setError(err instanceof Error ? err.message : 'Failed to load workers')
    } finally {
      if (!isStale()) setIsRefreshing(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => {
      mounted.current = false
      window.clearInterval(interval)
    }
  }, [refresh])

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Connected workers</h1>
            <p className={styles.pageIntro}>
              Remote crawler workers currently connected to the coordinator, with their capabilities and current load.
            </p>
          </div>
          <Link href="/ops" className={styles.backLink}>← Operations</Link>
        </div>

        <div className={styles.controlsBar}>
          <span className={styles.refreshMeta}>
            {updatedAt ? `Updated ${fmtTime(updatedAt)}` : 'Loading…'}
          </span>
          <div className={styles.controlsBarRight}>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => void refresh()} disabled={isRefreshing}>
              <ACTION_ICONS.refresh size={13} aria-hidden="true" />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <p className={workerStyles.notice}>
          “Last heartbeat received” is when the coordinator last got the worker’s own heartbeat message. It is a
          secondary signal, not proof the worker is alive: whether a worker stays connected is decided by WebSocket
          ping/pong, so a disconnected worker can take roughly 30–60 seconds to disappear from this list.
        </p>

        {error && (
          <p className={styles.error} role="alert">
            Connected workers could not load: {error}. Check that the API is running, then refresh this page.
            {workers ? ' The list below is the last successful result and may be out of date.' : ''}
          </p>
        )}

        {!workers ? (
          error ? null : (
            <p className={styles.empty}>Loading connected workers. If this takes more than a few seconds, confirm the API is running and refresh.</p>
          )
        ) : workers.length === 0 ? (
          <p className={styles.empty}>No workers are connected. Start a worker (for example with make worker), then refresh.</p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <caption className="sr-only">Connected workers</caption>
              <thead>
                <tr>
                  <th scope="col">Worker</th>
                  <th scope="col">Capabilities</th>
                  <th scope="col">In-flight / max jobs</th>
                  <th scope="col">Current job</th>
                  <th scope="col">Last heartbeat received</th>
                  <th scope="col"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker, index) => {
                  // A reconnecting worker briefly has two sockets sharing one workerId.
                  const rowKey = `${worker.workerId}-${index}`
                  const expanded = expandedRows.has(rowKey)
                  const expandable = worker.inFlightJobs.length > 0 || worker.recentJobs.length > 0
                  const detailRowId = `worker-details-${rowKey}`
                  const [current, ...rest] = worker.inFlightJobs
                  return (
                    <Fragment key={rowKey}>
                      <tr>
                        <td>
                          <span className={workerStyles.workerName}>{worker.workerName}</span>
                          <span className={workerStyles.workerId}>{worker.workerId}</span>
                        </td>
                        <td>
                          <div className={workerStyles.badges}>
                            <span className={styles.badge} data-variant={worker.capabilities.chromium ? 'success' : 'muted'}>
                              chromium: {worker.capabilities.chromium ? 'yes' : 'no'}
                            </span>
                            <span className={styles.badge} data-variant={worker.capabilities.httpEnrich ? 'success' : 'muted'}>
                              httpEnrich: {worker.capabilities.httpEnrich ? 'yes' : 'no'}
                            </span>
                          </div>
                        </td>
                        <td>
                          {worker.inFlightCount} / {worker.capabilities.maxConcurrentJobs}
                        </td>
                        <td>
                          {current ? (
                            <>
                              <span>{current.queueName}</span>{' '}
                              <span className={workerStyles.muted}>
                                · <RelativeTimestamp value={current.dispatchedAt} />
                              </span>
                              {rest.length > 0 ? (
                                <span className={workerStyles.muted}> +{rest.length} more</span>
                              ) : null}
                            </>
                          ) : (
                            <span className={workerStyles.muted}>—</span>
                          )}
                        </td>
                        <td>
                          <RelativeTimestamp value={worker.lastHeartbeatAt} />
                        </td>
                        <td className={workerStyles.expandCell}>
                          {expandable ? (
                            <button
                              type="button"
                              className={workerStyles.expandBtn}
                              aria-label={expanded ? `Collapse job details for ${worker.workerName}` : `Expand job details for ${worker.workerName}`}
                              aria-expanded={expanded}
                              aria-controls={detailRowId}
                              onClick={() => toggleRow(rowKey)}
                            >
                              {expanded ? '▲' : '▼'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {expandable ? (
                        <tr key={`${rowKey}-details`} id={detailRowId} className={workerStyles.detailRow} hidden={!expanded}>
                          <td colSpan={6}>
                            <div className={workerStyles.jobDetails}>
                              <div>
                                <p className={workerStyles.jobSectionLabel}>Running now</p>
                                {worker.inFlightJobs.length > 0 ? (
                                  <ul className={workerStyles.jobList}>
                                    {worker.inFlightJobs.map((job) => (
                                      <li key={job.correlationId} className={workerStyles.jobItem}>
                                        <strong>{job.queueName}</strong>
                                        <span className={workerStyles.corrId}>{job.correlationId}</span>
                                        <span className={workerStyles.muted}>
                                          running since <RelativeTimestamp value={job.dispatchedAt} />
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className={workerStyles.muted}>Idle — nothing dispatched.</p>
                                )}
                              </div>
                              <div>
                                <p className={workerStyles.jobSectionLabel}>Recent jobs</p>
                                {worker.recentJobs.length > 0 ? (
                                  <ul className={workerStyles.jobList}>
                                    {worker.recentJobs.map((job, jobIndex) => (
                                      <li key={`${job.correlationId}-${job.finishedAt}-${jobIndex}`} className={workerStyles.jobItem}>
                                        <span
                                          className={styles.badge}
                                          data-variant={job.escalated ? 'warning' : job.success ? 'success' : 'danger'}
                                        >
                                          {job.escalated ? 'escalated' : job.success ? 'ok' : 'failed'}
                                        </span>
                                        <span>{job.queueName}</span>
                                        <span className={workerStyles.corrId}>{job.correlationId}</span>
                                        <span className={workerStyles.muted}>
                                          <RelativeTimestamp value={job.finishedAt} />
                                        </span>
                                        {job.errorMessage ? (
                                          <span className={workerStyles.corrId}>{job.errorMessage}</span>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className={workerStyles.muted}>No finished jobs recorded yet.</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
