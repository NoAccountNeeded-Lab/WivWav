'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { RelativeTimestamp } from '@/lib/relative-time'
import styles from '../ops.module.css'
import workerStyles from './WorkersClient.module.css'
import { ACTION_ICONS } from '../action-icons'
import { FleetSummary, QueueTable } from './FleetSummary'
import { PIP_GLYPH, WorkerCard, workerStatus } from './WorkerCard'
import { parseWorkers, type ConnectedWorker, type WorkersPayload } from './workers-data'

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
  const [data, setData] = useState<WorkersPayload | null>(null)
  const [now, setNow] = useState(() => Date.now())
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
      const payload = parseWorkers(await res.json())
      if (isStale()) return
      setData(payload)
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      if (isStale()) return
      setError(err instanceof Error ? err.message : 'Failed to load workers')
    } finally {
      if (!isStale()) setIsRefreshing(false)
    }
  }, [apiBaseUrl])

  // Connections with a pause/resume in flight, held until the refreshed list shows the new state.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const setPendingFor = (id: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const [actionError, setActionError] = useState<string | null>(null)

  const toggle = useCallback(async (worker: ConnectedWorker) => {
    const verb = worker.accepting ? 'pause' : 'resume'
    setPendingFor(worker.connectionId, true)
    setActionError(null)
    try {
      const res = await fetch(
        `${apiBaseUrl}/internal/ops/workers/${encodeURIComponent(worker.connectionId)}/${verb}`,
        { method: 'POST' },
      )
      if (!res.ok) throw new Error(res.status === 404 ? 'that worker has disconnected' : `API returned ${res.status}`)
    } catch (err) {
      if (mounted.current) setActionError(`Could not ${verb} ${worker.workerName}: ${err instanceof Error ? err.message : 'failed'}`)
    }
    await refresh()
    if (mounted.current) setPendingFor(worker.connectionId, false)
  }, [apiBaseUrl, refresh])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    // One shared 1s tick drives every elapsed timer and heartbeat age.
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      mounted.current = false
      window.clearInterval(interval)
      window.clearInterval(tick)
    }
  }, [refresh])

  const workers = data?.workers ?? null
  const stale = workers ? workers.filter((w) => workerStatus(w, now) === 'stale').length : 0
  const busy = workers ? workers.filter((w) => workerStatus(w, now) === 'busy').length : 0
  const paused = workers ? workers.filter((w) => !w.accepting).length : 0
  const idle = workers ? workers.filter((w) => workerStatus(w, now) === 'idle').length : 0

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Workers</h1>
            <p className={styles.pageIntro}>
              Every connected crawler worker, what it is doing now, and fleet statistics. Statistics are kept in
              memory and reset when the API restarts
              {data?.summary.statsSince ? <> (counting since <RelativeTimestamp value={data.summary.statsSince} />)</> : null}.
            </p>
          </div>
          <Link href="/ops" className={styles.backLink}>← Operations</Link>
        </div>

        <div className={styles.controlsBar}>
          <span className={styles.refreshMeta}>
            {updatedAt ? `Updated ${fmtTime(updatedAt)} · refreshes every 15s` : 'Loading…'}
          </span>
          <div className={styles.controlsBarRight}>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => void refresh()} disabled={isRefreshing}>
              <ACTION_ICONS.refresh size={13} aria-hidden="true" />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <p className={workerStyles.notice}>
          “Heartbeat” is when the coordinator last got the worker’s own heartbeat message. It is a secondary signal,
          not proof the worker is alive: whether a worker stays connected is decided by WebSocket ping/pong, so a
          disconnected worker can take roughly 30–60 seconds to disappear from this list.
        </p>

        {error && (
          <p className={styles.error} role="alert">
            Connected workers could not load: {error}. Check that the API is running, then refresh this page.
            {data ? ' The list below is the last successful result and may be out of date.' : ''}
          </p>
        )}

        {actionError && <p className={styles.error} role="alert">{actionError}</p>}

        {!data || !workers ? (
          error ? null : (
            <p className={styles.empty}>Loading connected workers. If this takes more than a few seconds, confirm the API is running and refresh.</p>
          )
        ) : workers.length === 0 ? (
          <p className={styles.empty}>No workers are connected. Start a worker (for example with make worker), then refresh.</p>
        ) : (
          <div className={workerStyles.page}>
            <FleetSummary summary={data.summary} busy={busy} idle={idle} stale={stale} paused={paused} />
            <div className={workerStyles.split}>
              <section aria-labelledby="wd-workers" className={workerStyles.fleet}>
                <div className={workerStyles.fleetHead}>
                  <h2 id="wd-workers" className={workerStyles.h2}>Fleet</h2>
                  <ul aria-label="Legend" className={workerStyles.legend}>
                    <li><span className={workerStyles.pip} data-kind="ok" aria-hidden="true" />Succeeded</li>
                    <li><span className={workerStyles.pip} data-kind="fail" aria-hidden="true">×</span>Failed</li>
                    <li><span className={workerStyles.pip} data-kind="esc" aria-hidden="true">{PIP_GLYPH.esc}</span>Escalated (requeued)</li>
                  </ul>
                </div>
                <div className={workerStyles.cards}>
                  {workers.map((worker) => (
                    // connectionId is unique per socket; workerId can repeat during a reconnect.
                    <WorkerCard
                      key={worker.connectionId}
                      worker={worker}
                      now={now}
                      onToggle={(w) => void toggle(w)}
                      pending={pending.has(worker.connectionId)}
                    />
                  ))}
                </div>
              </section>
              <QueueTable queues={data.summary.queues} />
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
