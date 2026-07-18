'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RelativeTimestamp } from '@/lib/relative-time'
import { Activity } from 'lucide-react'
import { ScrapeRunChart, type ScrapeRunPoint } from '@wivwav/charts'
import { DataTable, dataTableStyles } from '@/components/DataTable'
import { OpsStatusChip } from '@/components/OpsStatusChip'
import styles from '../ops.module.css'
import { ACTION_ICONS } from '../action-icons'

interface RunRow {
  id: string
  sourceId: string
  sourceName: string | null
  startedAt: string
  finishedAt: string | null
  success: boolean | null
  listingsFound: number | null
  listingsNew: number | null
  listingsUpdated: number | null
  errorMessage: string | null
}

type Filter = 'all' | 'success' | 'failed' | 'running'

interface RunsClientProps {
  apiBaseUrl: string
}

const REFRESH_MS = 15_000
const RUN_COLUMNS = [
  { key: 'started', label: 'Started' },
  { key: 'source', label: 'Source' },
  { key: 'result', label: 'Result' },
  { key: 'duration', label: 'Duration' },
  { key: 'found', label: 'Found', align: 'end' as const },
  { key: 'new', label: 'New', align: 'end' as const },
  { key: 'updated', label: 'Updated', align: 'end' as const },
  { key: 'error', label: 'Error' },
]

function duration(start: string, end: string | null): string {
  if (!end) return 'running…'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatCount(value: number | null): string {
  return value == null ? '—' : value.toLocaleString()
}

function resultChip(success: boolean | null) {
  if (success == null) return <OpsStatusChip label="In progress" variant="neutral" />
  if (success) return <OpsStatusChip label="Success" variant="success" />
  return <OpsStatusChip label="Failed" variant="danger" />
}

export function RunsClient({ apiBaseUrl }: RunsClientProps) {
  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch(`${apiBaseUrl}/admin/runs`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: RunRow[] }
      setRuns(body.data)
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs')
    } finally {
      setIsRefreshing(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  const filtered = useMemo(() => {
    if (!runs) return null
    if (filter === 'all') return runs
    if (filter === 'success') return runs.filter(r => r.success === true)
    if (filter === 'failed') return runs.filter(r => r.success === false)
    if (filter === 'running') return runs.filter(r => r.success === null)
    return runs
  }, [runs, filter])

  const counts = useMemo(() => {
    if (!runs) return { success: 0, failed: 0, running: 0 }
    return {
      success: runs.filter(r => r.success === true).length,
      failed: runs.filter(r => r.success === false).length,
      running: runs.filter(r => r.success === null).length,
    }
  }, [runs])

  // `/admin/runs` returns newest-first; ScrapeRunChart expects oldest-first
  // (it renders left-to-right and keeps the most recent `maxBars` entries
  // via `.slice(-maxBars)`), so reverse before mapping.
  const scrapeRunPoints = useMemo<ScrapeRunPoint[]>(() => {
    if (!filtered) return []
    return [...filtered].reverse().map(r => ({
      label: r.sourceName ?? r.sourceId,
      success: r.success,
      listingsFound: r.listingsFound,
    }))
  }, [filtered])

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Listing import activity</h1>
            <p className={styles.pageIntro}>Track recent source runs, listing changes, failures, and stuck imports.</p>
          </div>
          <Link href="/ops" className={styles.backLink}>← Operations</Link>
        </div>

        <div className={styles.controlsBar}>
          <div className={styles.filterGroup} role="group" aria-label="Filter runs">
            {(['all', 'running', 'success', 'failed'] as Filter[]).map(f => (
              <button
                key={f}
                className={styles.filterPill}
                type="button"
                data-active={filter === f ? 'true' : 'false'}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? `All (${runs?.length ?? 0})` : null}
                {f === 'running' ? `Running (${counts.running})` : null}
                {f === 'success' ? `Success (${counts.success})` : null}
                {f === 'failed' ? `Failed (${counts.failed})` : null}
              </button>
            ))}
          </div>
          <div className={styles.controlsBarRight}>
            <span className={styles.refreshMeta}>
              {updatedAt ? `Updated ${fmtTime(updatedAt)}` : 'Loading…'}
            </span>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => void refresh()} disabled={isRefreshing}>
              <ACTION_ICONS.refresh size={13} aria-hidden="true" />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {filtered && filtered.length > 0 && (
          <div className={styles.chartCard}>
            <div className={styles.chartCardHeader}>
              <Activity size={12} />
              <span>Scrape Run History</span>
              <span className={styles.chartHint}>
                Last {Math.min(scrapeRunPoints.length, 20)} {filter !== 'all' ? `${filter} ` : ''}runs · success/failure per run · height = listings found
              </span>
            </div>
            <div className={styles.chartCardBody}>
              <ScrapeRunChart
                runs={scrapeRunPoints}
                ariaLabel="Bar chart of recent scrape run results; green bars are successful runs, red bars are failed runs, height indicates listings found"
              />
            </div>
          </div>
        )}

        {error ? (
          <p className={styles.error}>Listing import activity could not load: {error}. Check the API, then refresh this page.</p>
        ) : !filtered ? (
          <p className={styles.empty}>Loading recent listing import activity. If this takes too long, confirm the API is running and refresh.</p>
        ) : !filtered.length ? (
          <p className={styles.empty}>
            No {filter !== 'all' ? `${filter} ` : ''}runs found. Run a source from Source health or choose a different filter.
          </p>
        ) : (
          <DataTable
            ariaLabel="Listing import activity runs"
            caption={`${filtered.length} ${filtered.length === 1 ? 'run' : 'runs'} in the current filter`}
            columns={RUN_COLUMNS}
          >
            {filtered.map(r => (
              <tr key={r.id} className={dataTableStyles.row}>
                <td className={dataTableStyles.muted}><RelativeTimestamp value={r.startedAt} /></td>
                <td>
                  {r.sourceName ? (
                    <>
                      <span className={dataTableStyles.primary}>{r.sourceName}</span>
                      <span className={`${dataTableStyles.secondary} ${dataTableStyles.mono}`}>{r.sourceId}</span>
                    </>
                  ) : (
                    <span className={`${dataTableStyles.primary} ${dataTableStyles.mono}`}>{r.sourceId}</span>
                  )}
                </td>
                <td className={dataTableStyles.statusCell}>{resultChip(r.success)}</td>
                <td className={dataTableStyles.muted}>{duration(r.startedAt, r.finishedAt)}</td>
                <td className={dataTableStyles.numeric}>{formatCount(r.listingsFound)}</td>
                <td className={dataTableStyles.numeric}>{formatCount(r.listingsNew)}</td>
                <td className={dataTableStyles.numeric}>{formatCount(r.listingsUpdated)}</td>
                <td>
                  {r.errorMessage ? (
                    <span className={styles.errorMsg}>{r.errorMessage}</span>
                  ) : (
                    <span className={dataTableStyles.muted}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        <details className={styles.helpPanel}>
          <summary>What scraper runs represent</summary>
          <div className={styles.helpBody}>
            <p>A <strong>scraper run</strong> is a single execution of the source-scrape job for one data source. Each run record tracks:</p>
            <ul>
              <li><strong>Found</strong> — total listings returned by the source during this run</li>
              <li><strong>New</strong> — listings that didn't exist in the database before this run</li>
              <li><strong>Updated</strong> — listings that already existed but had changed fields</li>
            </ul>
            <p>A run marked <strong>In progress</strong> is currently executing (or crashed before it could write a result — check the scraper service logs if a run stays in this state for more than 30 minutes).</p>
            <p>Runs only cover the source listing step. Detail refreshes, geocoding, deduplication, and search sync are tracked on <Link href="/ops/queues" style={{ color: 'var(--clr-primary)' }}>Advanced queue diagnostics</Link>.</p>
          </div>
        </details>
      </div>
    </main>
  )
}
