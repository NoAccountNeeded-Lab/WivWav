'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Globe, Link2, RadioTower } from 'lucide-react'
import { EntityList, EntityListRow, EntityMetaItem } from '@/components/EntityListRow'
import { OpsStatusChip, type OpsStatusVariant } from '@/components/OpsStatusChip'
import { OpsRunbooks } from '../OpsRunbooks'
import { RelativeTimestamp } from '@/lib/relative-time'
import styles from '../ops.module.css'
import { SOURCE_RUNBOOK_IDS } from '../runbooks'
import { ACTION_ICONS } from '../action-icons'

interface SourceRow {
  id: string
  name: string
  baseUrl: string
  status: string
  cronExpression: string
  lastScrapedAt: string | null
  listingCount: number
  observedActiveCount: number
  eligibleActiveCount: number
  errorMessage: string | null
}

interface RunState {
  loading: boolean
  feedback: string | null
  jobId: string | null
  isError: boolean
}

interface SourcesClientProps {
  apiBaseUrl: string
}

const REFRESH_MS = 30_000

function statusVariant(status: string): OpsStatusVariant {
  if (status === 'active') return 'success'
  if (status === 'paused') return 'paused'
  if (status === 'disabled') return 'neutral'
  if (status === 'error' || status === 'needs_remapping') return 'danger'
  return 'neutral'
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ')
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatCount(value: number): string {
  return value.toLocaleString()
}

export function SourcesClient({ apiBaseUrl }: SourcesClientProps) {
  const [sources, setSources] = useState<SourceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [runStates, setRunStates] = useState<Record<string, RunState>>({})

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sources`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: SourceRow[] }
      setSources(body.data)
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources')
    } finally {
      setIsRefreshing(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  async function runNow(sourceId: string) {
    setRunStates(prev => ({ ...prev, [sourceId]: { loading: true, feedback: null, jobId: null, isError: false } }))
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sources/${encodeURIComponent(sourceId)}/run`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const body = (await res.json()) as { data: { id: string } }
      setRunStates(prev => ({ ...prev, [sourceId]: { loading: false, feedback: 'Job enqueued', jobId: body.data.id, isError: false } }))
    } catch (err) {
      setRunStates(prev => ({ ...prev, [sourceId]: { loading: false, feedback: err instanceof Error ? err.message : 'Error', jobId: null, isError: true } }))
    }
  }

  async function setSourceEnabled(sourceId: string, enabled: boolean) {
    setRunStates(prev => ({ ...prev, [sourceId]: { loading: true, feedback: null, jobId: null, isError: false } }))
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sources/${encodeURIComponent(sourceId)}/${enabled ? 'enable' : 'disable'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: enabled ? JSON.stringify({}) : JSON.stringify({ reason: 'Disabled from ops source health' }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setRunStates(prev => ({ ...prev, [sourceId]: { loading: false, feedback: enabled ? 'Source enabled' : 'Source disabled', jobId: null, isError: false } }))
      await refresh()
    } catch (err) {
      setRunStates(prev => ({ ...prev, [sourceId]: { loading: false, feedback: err instanceof Error ? err.message : 'Error', jobId: null, isError: true } }))
    }
  }

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Source health</h1>
            <p className={styles.pageIntro}>Review source status, observed inventory, publication eligibility, scrape timing, and source-specific errors.</p>
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

        <OpsRunbooks ids={SOURCE_RUNBOOK_IDS} />

        {error ? (
          <p className={styles.error}>Sources could not load: {error}. Check the API, then refresh this page.</p>
        ) : !sources ? (
          <p className={styles.empty}>Loading source health. If this does not finish, confirm the API is running and refresh.</p>
        ) : !sources.length ? (
          <p className={styles.empty}>No sources found. Add or seed sources before running listing imports.</p>
        ) : (
          <EntityList ariaLabel="Source health rows">
            {sources.map((s) => {
              const rs = runStates[s.id]
              return (
                <EntityListRow
                  key={s.id}
                  icon={<RadioTower size={18} />}
                  title={s.name}
                  href={`/ops/sources/${encodeURIComponent(s.id)}`}
                  ariaLabel={`${s.name}, status ${statusLabel(s.status)}, ${formatCount(s.listingCount)} total listings, ${formatCount(s.observedActiveCount)} observed active, ${formatCount(s.eligibleActiveCount)} eligible active`}
                  status={<OpsStatusChip label={statusLabel(s.status)} variant={statusVariant(s.status)} />}
                  secondary={(
                    <>
                      <a href={s.baseUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.name} website`}>
                        {s.baseUrl}
                      </a>
                    </>
                  )}
                  meta={(
                    <>
                      <EntityMetaItem><Link2 size={12} aria-hidden="true" /> <code>{s.cronExpression}</code></EntityMetaItem>
                      <EntityMetaItem emphasis><Globe size={12} aria-hidden="true" /> {formatCount(s.listingCount)} listed</EntityMetaItem>
                      <EntityMetaItem emphasis>{formatCount(s.observedActiveCount)} observed active</EntityMetaItem>
                      <EntityMetaItem emphasis>{formatCount(s.eligibleActiveCount)} eligible</EntityMetaItem>
                      <EntityMetaItem><RelativeTimestamp value={s.lastScrapedAt} fallback="No recent scrape" /></EntityMetaItem>
                    </>
                  )}
                  actions={(
                    <>
                      <button
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        type="button"
                        disabled={rs?.loading || s.status === 'disabled' || s.status === 'paused'}
                        onClick={() => void runNow(s.id)}
                        aria-label={`Run ${s.name} scrape now`}
                      >
                        <ACTION_ICONS.trigger size={14} aria-hidden="true" />
                        {rs?.loading ? 'Enqueueing…' : 'Run Now'}
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnGhost}`}
                        type="button"
                        disabled={rs?.loading}
                        onClick={() => void setSourceEnabled(s.id, s.status === 'disabled')}
                        aria-label={`${s.status === 'disabled' ? 'Enable' : 'Disable'} ${s.name}`}
                      >
                        {s.status === 'disabled'
                          ? <ACTION_ICONS.enable size={14} aria-hidden="true" />
                          : <ACTION_ICONS.disable size={14} aria-hidden="true" />}
                        {s.status === 'disabled' ? 'Enable' : 'Disable'}
                      </button>
                    </>
                  )}
                  feedback={rs?.feedback ? (
                    rs.jobId
                      ? <>{rs.feedback} - Job ID: <Link href={`/ops/logs?search=${encodeURIComponent(rs.jobId)}`}>{rs.jobId}</Link></>
                      : rs.feedback
                  ) : s.errorMessage ? (
                    <>
                      <span className={styles.errorMsg}>{s.errorMessage}</span>
                      {' · '}
                      <Link href={`/ops/runs?sourceId=${encodeURIComponent(s.id)}&filter=failed`}>View run</Link>
                      {' · '}
                      <Link href={`/ops/logs?service=scraper&search=${encodeURIComponent(s.id)}`}>View logs</Link>
                    </>
                  ) : undefined}
                  feedbackIsError={Boolean(rs?.isError || s.errorMessage)}
                />
              )
            })}
          </EntityList>
        )}

        <details className={styles.helpPanel}>
          <summary>How source scraping works</summary>
          <div className={styles.helpBody}>
            <p>Each source is a website that lists wheelchair accessible vehicles (WAVs). The scraper pipeline has several stages:</p>
            <ol>
              <li><strong>source-scrape</strong> — Fetches the listing index page(s) from a source and upserts listings into the database. Before scraping, it checks whether the site's HTML structure has changed — if it has, the configured AI provider remaps the CSS selectors automatically.</li>
              <li><strong>detail-crawl</strong> — Uses Playwright to open each listing's detail URL and store the full HTML. This is needed because many WAV-specific fields (ramp type, lift, controls) only appear on the detail page.</li>
              <li><strong>detail-extract</strong> — Parses the stored detail HTML without any network calls to extract WAV fields.</li>
              <li><strong>geocode</strong> — Converts city + state to GPS coordinates so listings can be shown on a map.</li>
              <li><strong>deduplicate</strong> — Detects the same vehicle sold across multiple sources (matched by VIN) and assigns one vehicle identity across those rows.</li>
            </ol>
            <p><strong>Run Now</strong> immediately enqueues a source-scrape job, bypassing the cron schedule. Useful after fixing an error or adding a new source.</p>
            <p>Status <strong>error</strong> means the last run failed. This includes low-confidence AI remaps (confidence below 0.7) where the AI's notes and score are stored in the Error column. The source will retry automatically on its next scheduled run.</p>
            <p>Status <strong>needs_remapping</strong> means the site's HTML changed but the AI could not attempt a remap at all — either no HTML sample was captured or the AI provider was unavailable. The Error column shows which failure mode occurred. Operator intervention is required: fix the underlying cause, then use <strong>Run Now</strong> to trigger a retry.</p>
          </div>
        </details>
      </div>
    </main>
  )
}
