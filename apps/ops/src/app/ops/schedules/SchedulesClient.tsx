'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Clock3, RotateCcw } from 'lucide-react'
import { EntityList, EntityListRow, EntityMetaItem } from '@/components/EntityListRow'
import { OpsStatusChip, type OpsStatusVariant } from '@/components/OpsStatusChip'
import { OpsRunbooks } from '../OpsRunbooks'
import styles from '../ops.module.css'
import { SCHEDULE_RUNBOOK_IDS } from '../runbooks'
import { ACTION_ICONS } from '../action-icons'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { RelativeTimestamp } from '@/lib/relative-time'
import { ScheduleTimeline } from './ScheduleTimeline'

export interface ScheduleEntry {
  id: string
  queue: string
  jobId: string | null
  label: string
  name: string
  data: Record<string, unknown>
  defaultPattern: string
  tz: string
  enabled: boolean
  key: string | null
  pattern: string
  next: number | null
  lastRunAt: string | null
  lastStatus: 'active' | 'completed' | 'failed' | null
  recentFailureCount: number
  recentFailureReason: string | null
}

interface SchedulesClientProps {
  apiBaseUrl: string
}

interface EditState {
  id: string
  pattern: string
}

interface ActionState {
  loading: boolean
  feedback: string | null
  isError: boolean
}

const REFRESH_MS = 30_000

function enabledStatus(enabled: boolean): { label: string; variant: OpsStatusVariant } {
  return enabled
    ? { label: 'Enabled', variant: 'success' }
    : { label: 'Disabled', variant: 'neutral' }
}

function lastRunVariant(status: ScheduleEntry['lastStatus']): OpsStatusVariant {
  if (status === 'failed') return 'danger'
  if (status === 'active') return 'warning'
  if (status === 'completed') return 'success'
  return 'muted'
}

export function SchedulesClient({ apiBaseUrl }: SchedulesClientProps) {
  const [schedules, setSchedules] = useState<ScheduleEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})
  const [editState, setEditState] = useState<EditState | null>(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await fetchWithTimeout(`${apiBaseUrl}/admin/repeatables`, { cache: 'no-store' }, 10_000)
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: ScheduleEntry[] }
      setSchedules(body.data)
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Request timed out while loading schedules')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load schedules')
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  function setAction(id: string, state: ActionState) {
    setActionStates((prev) => ({ ...prev, [id]: state }))
  }

  async function disable(entry: ScheduleEntry) {
    if (!entry.key) return
    setAction(entry.id, { loading: true, feedback: null, isError: false })
    try {
      const res = await fetch(`${apiBaseUrl}/admin/repeatables/${encodeURIComponent(entry.queue)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: entry.key }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setAction(entry.id, { loading: false, feedback: 'Disabled', isError: false })
      setTimeout(() => void refresh(), 500)
    } catch (err) {
      setAction(entry.id, { loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true })
    }
  }

  async function enable(entry: ScheduleEntry, pattern?: string) {
    setAction(entry.id, { loading: true, feedback: null, isError: false })
    try {
      const res = await fetch(`${apiBaseUrl}/admin/repeatables/${encodeURIComponent(entry.queue)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: entry.name,
          data: entry.data,
          pattern: pattern ?? entry.pattern,
          tz: entry.tz,
          jobId: entry.jobId ?? undefined,
        }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setAction(entry.id, { loading: false, feedback: 'Enabled', isError: false })
      setEditState(null)
      setTimeout(() => void refresh(), 500)
    } catch (err) {
      setAction(entry.id, { loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true })
    }
  }

  async function clearFailed(entry: ScheduleEntry) {
    setAction(entry.id, { loading: true, feedback: null, isError: false })
    try {
      const res = await fetch(`${apiBaseUrl}/admin/queues/${encodeURIComponent(entry.queue)}/failed`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const body = (await res.json()) as { data: { removed: number } }
      setAction(entry.id, { loading: false, feedback: `Cleared ${body.data.removed} failed`, isError: false })
      setTimeout(() => void refresh(), 500)
    } catch (err) {
      setAction(entry.id, { loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true })
    }
  }

  async function updatePattern(entry: ScheduleEntry, newPattern: string) {
    if (!entry.key) { await enable(entry, newPattern); return }
    setAction(entry.id, { loading: true, feedback: null, isError: false })
    try {
      const res = await fetch(`${apiBaseUrl}/admin/repeatables/${encodeURIComponent(entry.queue)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: entry.key,
          name: entry.name,
          data: entry.data,
          pattern: newPattern,
          tz: entry.tz,
          jobId: entry.jobId ?? undefined,
        }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setAction(entry.id, { loading: false, feedback: 'Updated', isError: false })
      setEditState(null)
      setTimeout(() => void refresh(), 500)
    } catch (err) {
      setAction(entry.id, { loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true })
    }
  }

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Recurring jobs</h1>
            <p className={styles.pageIntro}>Control when automatic listing refresh, geocoding, and safety-data jobs run.</p>
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

        <OpsRunbooks ids={SCHEDULE_RUNBOOK_IDS} />

        {error ? (
          <p className={styles.error}>Recurring jobs could not load: {error}. Check the API and worker services, then refresh this page.</p>
        ) : !schedules ? (
          <p className={styles.empty}>Loading recurring jobs. If this does not finish, confirm the API and worker services are running.</p>
        ) : schedules.length === 0 ? (
          <p className={styles.empty}>No recurring jobs are registered. Start the scraper worker so default schedules can be registered, then refresh.</p>
        ) : (
          <>
          <ScheduleTimeline schedules={schedules} />
          <EntityList ariaLabel="Recurring job rows">
            {schedules.map((entry) => {
              const act = actionStates[entry.id]
              const isEditing = editState?.id === entry.id
              const enabled = enabledStatus(entry.enabled)

              return (
                <EntityListRow
                  key={entry.id}
                  icon={<CalendarClock size={18} />}
                  title={entry.label}
                  ariaLabel={`${entry.label}, ${enabled.label}, queue ${entry.queue}, pattern ${entry.pattern}, ${entry.recentFailureCount} recent failures`}
                  status={<OpsStatusChip label={enabled.label} variant={enabled.variant} />}
                  secondary={`${entry.name}${entry.jobId ? ` · ${entry.jobId}` : ''}`}
                  meta={(
                    <>
                      <EntityMetaItem><code>{entry.queue}</code></EntityMetaItem>
                      <EntityMetaItem><Clock3 size={12} aria-hidden="true" /> <code>{entry.pattern}</code></EntityMetaItem>
                      <EntityMetaItem>{entry.tz}</EntityMetaItem>
                      <EntityMetaItem>Next <RelativeTimestamp value={entry.next} fallback="—" /></EntityMetaItem>
                      <EntityMetaItem>Last <RelativeTimestamp value={entry.lastRunAt} fallback="No recent run" /></EntityMetaItem>
                      <EntityMetaItem>
                        <OpsStatusChip
                          label={entry.lastStatus ?? 'No result'}
                          variant={lastRunVariant(entry.lastStatus)}
                        />
                      </EntityMetaItem>
                      <EntityMetaItem emphasis>{entry.recentFailureCount.toLocaleString()} recent failures</EntityMetaItem>
                    </>
                  )}
                  actions={(
                    <>
                      {entry.enabled ? (
                        <button
                          className={`${styles.btn} ${styles.btnGhost}`}
                          type="button"
                          disabled={act?.loading}
                          onClick={() => void disable(entry)}
                        >
                          <ACTION_ICONS.disable size={14} aria-hidden="true" />
                          {act?.loading ? '…' : 'Disable'}
                        </button>
                      ) : (
                        <button
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          type="button"
                          disabled={act?.loading}
                          onClick={() => void enable(entry)}
                        >
                          <ACTION_ICONS.enable size={14} aria-hidden="true" />
                          {act?.loading ? '…' : 'Enable'}
                        </button>
                      )}
                      {!isEditing && (
                        <button
                          className={`${styles.btn} ${styles.btnGhost}`}
                          type="button"
                          disabled={act?.loading}
                          onClick={() => setEditState({ id: entry.id, pattern: entry.pattern })}
                        >
                          <ACTION_ICONS.edit size={14} aria-hidden="true" />
                          Edit
                        </button>
                      )}
                      {entry.recentFailureCount > 0 && (
                        <button
                          className={`${styles.btn} ${styles.btnGhost}`}
                          type="button"
                          disabled={act?.loading}
                          onClick={() => void clearFailed(entry)}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                          Clear
                        </button>
                      )}
                    </>
                  )}
                  feedback={act?.feedback ?? entry.recentFailureReason ?? undefined}
                  feedbackIsError={Boolean(act?.isError || entry.recentFailureReason)}
                  expandedContent={isEditing ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        className={styles.input}
                        value={editState.pattern}
                        onChange={(e) => setEditState({ id: entry.id, pattern: e.target.value })}
                        style={{ fontFamily: 'monospace', fontSize: '0.8125rem', width: '10rem' }}
                        aria-label="Cron pattern"
                      />
                      <button
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        style={{ padding: '0.25rem 0.625rem', fontSize: '0.8125rem' }}
                        type="button"
                        disabled={act?.loading}
                        onClick={() => void updatePattern(entry, editState.pattern)}
                      >
                        Save
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnGhost}`}
                        style={{ padding: '0.25rem 0.625rem', fontSize: '0.8125rem' }}
                        type="button"
                        onClick={() => setEditState(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : undefined}
                />
              )
            })}
          </EntityList>
          </>
        )}

        <details className={styles.helpPanel}>
          <summary>How schedules work</summary>
          <div className={styles.helpBody}>
            <p>Schedules are stored in <strong>Valkey (Redis)</strong> by BullMQ — not in node-cron or any config file. The scraper process registers defaults on first boot; from then on, what you see here is what runs.</p>
            <ul>
              <li><strong>Disable</strong> removes the repeatable from BullMQ. The job won't fire until re-enabled. A scraper restart will not re-add it.</li>
              <li><strong>Enable</strong> adds it back with the same (or default) pattern.</li>
              <li><strong>Edit</strong> lets you change the cron pattern without restarting anything. Changes take effect immediately — the next run is rescheduled in BullMQ.</li>
              <li><strong>NHTSA refresh jobs</strong> are listed here as canonical schedules: <code>vin-enrich</code> every 6 hours from 4 AM, <code>nhtsa-recalls</code> daily at 4:30 AM, <code>nhtsa-complaints</code> weekly Sunday at 5 AM, and <code>nhtsa-safety-ratings</code> weekly Sunday at 6 AM.</li>
            </ul>
            <p>Cron syntax: <code>minute hour day-of-month month day-of-week</code>. Examples: <code>0 2 * * *</code> = 2 AM daily, <code>*/5 * * * *</code> = every 5 minutes, <code>0 */6 * * *</code> = every 6 hours.</p>
            <p>Use the last-run and recent-failure columns for schedule health. To inspect payloads, logs, stack traces, or trigger a job immediately without waiting for the schedule, use <Link href="/ops/queues" style={{ color: 'var(--clr-primary)' }}>Advanced queue diagnostics</Link>.</p>
          </div>
        </details>
      </div>
    </main>
  )
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date)
}
