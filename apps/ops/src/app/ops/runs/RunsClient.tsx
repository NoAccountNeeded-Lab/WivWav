'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { RelativeTimestamp } from '@/lib/relative-time'
import { ScrapeRunChart, type ScrapeRunPoint } from '@wivwav/charts'
import { DataTable, dataTableStyles } from '@/components/DataTable'
import { OpsStatusChip } from '@/components/OpsStatusChip'
import { InspectorPanel } from '@/components/Inspector/InspectorPanel'
import { InspectorPortal } from '@/components/Inspector/InspectorPortal'
import { useInspectorParam } from '@/components/Inspector/useInspectorParam'
import type { PipelineStage } from '../sources/[id]/source-pipeline-helpers'
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
  { key: 'details', label: <span className={dataTableStyles.srOnly}>Details</span> },
]

const VALID_FILTERS: Filter[] = ['all', 'success', 'failed', 'running']

function isFilter(value: string | null): value is Filter {
  return value !== null && (VALID_FILTERS as string[]).includes(value)
}

/** Deep link to `/ops/logs` scoped to this run's source and time window (E6/#761). Runs
 *  have no `jobId` of their own (`scraper_runs` predates BullMQ job tracking), so the
 *  source-scrape service + sourceId + [startedAt, finishedAt] window is the strongest
 *  correlation available — the same allow-listed fields #757's `get_correlation` uses. */
function runLogsHref(run: RunRow): string {
  const params = new URLSearchParams()
  params.set('service', 'scraper')
  params.set('search', run.sourceId)
  params.set('start', run.startedAt)
  params.set('end', run.finishedAt ?? new Date().toISOString())
  return `/ops/logs?${params.toString()}`
}

function runSourceHref(run: RunRow): string {
  return `/ops/sources/${encodeURIComponent(run.sourceId)}`
}

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
  const searchParams = useSearchParams()
  // Read once at mount: an inbound deep link (e.g. from a source's last-error) scopes
  // the initial view, but subsequent in-page filter changes are client-owned state, same
  // as LogsClient's `initialSearch` pattern.
  const [initialFilterParam] = useState(() => searchParams.get('filter'))
  const sourceIdFilter = searchParams.get('sourceId')

  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>(isFilter(initialFilterParam) ? initialFilterParam : 'all')

  const inspector = useInspectorParam('run')
  const [pipelineStageBySource, setPipelineStageBySource] = useState<Record<string, PipelineStage | null>>({})

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

  // `sourceId` (from a source's last-error deep link) scopes the whole page — filter
  // pills, counts, and the chart — before the success/failed/running filter applies.
  const scopedRuns = useMemo(() => {
    if (!runs) return null
    if (!sourceIdFilter) return runs
    return runs.filter(r => r.sourceId === sourceIdFilter)
  }, [runs, sourceIdFilter])

  const filtered = useMemo(() => {
    if (!scopedRuns) return null
    if (filter === 'all') return scopedRuns
    if (filter === 'success') return scopedRuns.filter(r => r.success === true)
    if (filter === 'failed') return scopedRuns.filter(r => r.success === false)
    if (filter === 'running') return scopedRuns.filter(r => r.success === null)
    return scopedRuns
  }, [scopedRuns, filter])

  const counts = useMemo(() => {
    if (!scopedRuns) return { success: 0, failed: 0, running: 0 }
    return {
      success: scopedRuns.filter(r => r.success === true).length,
      failed: scopedRuns.filter(r => r.success === false).length,
      running: scopedRuns.filter(r => r.success === null).length,
    }
  }, [scopedRuns])

  const inspectedRun = useMemo(() => {
    if (!inspector.value || !runs) return null
    return runs.find(r => r.id === inspector.value) ?? null
  }, [inspector.value, runs])

  // Lazily fetch the source-scrape pipeline stage (for `latestFailedJobId`) only when
  // the inspector opens on a failed run, per source — never eagerly for every row.
  useEffect(() => {
    if (!inspectedRun || inspectedRun.success !== false) return
    const sourceId = inspectedRun.sourceId
    if (sourceId in pipelineStageBySource) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/admin/sources/${encodeURIComponent(sourceId)}/pipeline`, { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) setPipelineStageBySource(prev => ({ ...prev, [sourceId]: null }))
          return
        }
        const body = (await res.json()) as { data: { stages: PipelineStage[] } }
        const stage = body.data.stages.find(s => s.stage === 'source-scrape') ?? null
        if (!cancelled) setPipelineStageBySource(prev => ({ ...prev, [sourceId]: stage }))
      } catch {
        if (!cancelled) setPipelineStageBySource(prev => ({ ...prev, [sourceId]: null }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiBaseUrl, inspectedRun, pipelineStageBySource])

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

        {sourceIdFilter && (
          <p className={styles.muted} style={{ marginBottom: '0.75rem' }}>
            Filtered to source <strong>{scopedRuns?.[0]?.sourceName ?? sourceIdFilter}</strong>.{' '}
            <Link href="/ops/runs" style={{ color: 'var(--clr-primary)' }}>Clear filter</Link>
          </p>
        )}

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
                {f === 'all' ? `All (${scopedRuns?.length ?? 0})` : null}
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
              <ACTION_ICONS.activity size={12} aria-hidden="true" />
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
                <td>
                  <button
                    className={`${styles.btn} ${styles.btnGhost}`}
                    type="button"
                    onClick={() => inspector.open(r.id)}
                    aria-label={`View run details for ${r.sourceName ?? r.sourceId} started ${fmtTime(new Date(r.startedAt))}`}
                  >
                    Details
                  </button>
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

      <InspectorPortal>
        <InspectorPanel
          isOpen={inspector.isOpen}
          title={inspectedRun ? `Run · ${inspectedRun.sourceName ?? inspectedRun.sourceId}` : 'Run details'}
          onClose={inspector.close}
        >
          {!inspectedRun ? (
            <p className={styles.empty}>
              {runs ? 'This run is no longer available. It may have aged out of the last 100 runs.' : 'Loading run details…'}
            </p>
          ) : (
            <div className={styles.pipelineStrip} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p>{resultChip(inspectedRun.success)}</p>
              <p className={styles.muted}>
                Started <RelativeTimestamp value={inspectedRun.startedAt} /> · duration {duration(inspectedRun.startedAt, inspectedRun.finishedAt)}
              </p>
              <p className={styles.muted}>
                Found {formatCount(inspectedRun.listingsFound)} · New {formatCount(inspectedRun.listingsNew)} · Updated {formatCount(inspectedRun.listingsUpdated)}
              </p>
              {inspectedRun.errorMessage && (
                <p className={styles.errorMsg}>{inspectedRun.errorMessage}</p>
              )}
              <div className={styles.actions}>
                <Link href={runLogsHref(inspectedRun)} className={`${styles.btn} ${styles.btnGhost}`}>
                  Logs for this run
                </Link>
                <Link href={runSourceHref(inspectedRun)} className={`${styles.btn} ${styles.btnGhost}`}>
                  Source detail
                </Link>
              </div>
              {inspectedRun.success === false && (() => {
                const jobId = pipelineStageBySource[inspectedRun.sourceId]?.latestFailedJobId
                if (!jobId) return null
                return (
                  <p className={styles.muted}>
                    Latest source-scrape failure: job{' '}
                    <Link href={`/ops/logs?search=${encodeURIComponent(jobId)}`}>{jobId}</Link>
                  </p>
                )
              })()}
            </div>
          )}
        </InspectorPanel>
      </InspectorPortal>
    </main>
  )
}
