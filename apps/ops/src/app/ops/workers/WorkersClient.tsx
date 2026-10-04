'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { RelativeTimestamp } from '@/lib/relative-time'
import styles from '../ops.module.css'
import workerStyles from './WorkersClient.module.css'
import { ACTION_ICONS } from '../action-icons'

interface ConnectedWorker {
  workerId: string
  workerName: string
  capabilities: {
    chromium: boolean
    httpEnrich: boolean
    maxConcurrentJobs: number
  }
  inFlightCount: number
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

export function WorkersClient({ apiBaseUrl }: WorkersClientProps) {
  const [workers, setWorkers] = useState<ConnectedWorker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

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
      const body = (await res.json()) as { data: ConnectedWorker[] }
      if (isStale()) return
      setWorkers(body.data)
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
          <span className={styles.refreshMeta} role="status">
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
                  <th scope="col">Last heartbeat received</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker, index) => (
                  // A reconnecting worker briefly has two sockets sharing one workerId.
                  <tr key={`${worker.workerId}-${index}`}>
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
                      <RelativeTimestamp value={worker.lastHeartbeatAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
