'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import styles from '../ops.module.css'
import {
  buildListingRefreshSteps,
  getActiveSourceIds,
  type ListingRefreshStatus,
  type RefreshSource,
  type WorkflowActionId,
  type WorkflowHealth,
  type WorkflowStepStatus,
} from './listing-refresh-workflow'

interface RefreshListingsClientProps {
  apiBaseUrl: string
}

interface ActionState {
  loading: boolean
  feedback: string | null
  isError: boolean
}

const REFRESH_MS = 15_000

export function RefreshListingsClient({ apiBaseUrl }: RefreshListingsClientProps) {
  const [status, setStatus] = useState<ListingRefreshStatus | null>(null)
  const [health, setHealth] = useState<WorkflowHealth | null>(null)
  const [sources, setSources] = useState<RefreshSource[]>([])
  const [error, setError] = useState<string | null>(null)
  const [healthWarning, setHealthWarning] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [actionStates, setActionStates] = useState<Partial<Record<WorkflowActionId, ActionState>>>({})

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const [statusBody, sourcesBody, healthBody] = await Promise.all([
        fetchJson<{ data: ListingRefreshStatus }>(`${apiBaseUrl}/admin/listing-refresh/status`),
        fetchJson<{ data: RefreshSource[] }>(`${apiBaseUrl}/admin/sources`),
        fetchJson<WorkflowHealth>(`${apiBaseUrl}/health`).catch(() => null),
      ])
      setStatus(statusBody.data)
      setSources(sourcesBody.data)
      setHealth(healthBody)
      setHealthWarning(healthBody ? null : 'Service health could not be loaded; verify dependencies before triggering work.')
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listing refresh workflow')
    } finally {
      setIsRefreshing(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  const steps = useMemo(() => status ? buildListingRefreshSteps(status, health) : [], [health, status])

  function setAction(actionId: WorkflowActionId, state: ActionState) {
    setActionStates(prev => ({ ...prev, [actionId]: state }))
  }

  async function runAction(actionId: WorkflowActionId) {
    setAction(actionId, { loading: true, feedback: null, isError: false })
    try {
      if (actionId === 'run-sources') {
        const activeSourceIds = getActiveSourceIds(sources)
        if (activeSourceIds.length === 0) throw new Error('No active sources are available.')
        await Promise.all(activeSourceIds.map(sourceId => postJson(`${apiBaseUrl}/admin/sources/${encodeURIComponent(sourceId)}/run`)))
        setAction(actionId, { loading: false, feedback: `Enqueued ${activeSourceIds.length.toLocaleString()} source scrape jobs`, isError: false })
      } else if (actionId === 'run-detail-crawl') {
        const activeSourceIds = getActiveSourceIds(sources)
        if (activeSourceIds.length === 0) throw new Error('No active sources are available.')
        await Promise.all(activeSourceIds.map(sourceId =>
          postJson(`${apiBaseUrl}/admin/queues/detail-crawl/jobs`, { sourceId }),
        ))
        setAction(actionId, { loading: false, feedback: `Enqueued ${activeSourceIds.length.toLocaleString()} detail crawl jobs`, isError: false })
      } else if (actionId === 'run-detail-extract') {
        const activeSourceIds = getActiveSourceIds(sources)
        if (activeSourceIds.length === 0) throw new Error('No active sources are available.')
        await Promise.all(activeSourceIds.map(sourceId =>
          postJson(`${apiBaseUrl}/admin/queues/detail-extract/jobs`, { sourceId }),
        ))
        setAction(actionId, { loading: false, feedback: `Enqueued ${activeSourceIds.length.toLocaleString()} detail extract jobs`, isError: false })
      } else if (actionId === 'run-geocode') {
        const body = await postJson<{ data: { id: string } }>(`${apiBaseUrl}/admin/queues/geocode/jobs`)
        setAction(actionId, { loading: false, feedback: `Enqueued geocode job ${body.data.id}`, isError: false })
      } else {
        const body = await postJson<{ data: { synced: number } }>(`${apiBaseUrl}/admin/sync`)
        setAction(actionId, { loading: false, feedback: `Synced ${body.data.synced.toLocaleString()} listings`, isError: false })
      }
      setTimeout(() => void refresh(), 1000)
    } catch (err) {
      setAction(actionId, { loading: false, feedback: err instanceof Error ? err.message : 'Action failed', isError: true })
    }
  }

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Refresh listings</h1>
            <p className={styles.pageIntro}>Follow the safe sequence from source scrape through search and map verification.</p>
          </div>
          <Link href="/ops" className={styles.backLink}>← Operations</Link>
        </div>

        <div className={styles.controlsBar}>
          <span className={styles.refreshMeta}>
            {updatedAt ? `Updated ${fmtTime(updatedAt)}` : 'Loading…'}
          </span>
          <div className={styles.controlsBarRight}>
            <Link href="/ops/queues" className={`${styles.btn} ${styles.btnGhost}`}>Advanced queues</Link>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => void refresh()} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {healthWarning && <p className={styles.warningPanel}>{healthWarning}</p>}
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : !status ? (
          <p className={styles.empty}>Loading listing refresh workflow…</p>
        ) : (
          <>
            <section className={styles.workflowSummary} aria-label="Listing refresh summary">
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Observed active</span>
                <strong>{status.listings.observedActive.toLocaleString()}</strong>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Eligible to publish</span>
                <strong>{status.listings.eligible.toLocaleString()}</strong>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Map-ready</span>
                <strong>{status.listings.mapReady.toLocaleString()}</strong>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Missing locations</span>
                <strong>{status.listings.missingLocations.toLocaleString()}</strong>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Latest scrape</span>
                <strong>{status.latestScrapeRun ? fmtDate(status.latestScrapeRun.startedAt) : 'None'}</strong>
              </div>
            </section>

            <section className={styles.workflowList} aria-label="Listing refresh steps">
              {steps.map((step, index) => (
                <article key={step.id} className={styles.workflowStep}>
                  <div className={styles.workflowStepMarker} aria-hidden="true">{index + 1}</div>
                  <div className={styles.workflowStepBody}>
                    <div className={styles.workflowStepTopline}>
                      <h2 className={styles.workflowStepTitle}>{step.title}</h2>
                      <span className={styles.badge} data-variant={statusVariant(step.status)}>{statusLabel(step.status)}</span>
                    </div>
                    <dl className={styles.workflowFacts}>
                      <div>
                        <dt>Last run</dt>
                        <dd>{step.lastRunAt ? fmtDate(step.lastRunAt) : 'No run recorded'}</dd>
                      </div>
                      <div>
                        <dt>Counts</dt>
                        <dd>{step.countLabel}</dd>
                      </div>
                    </dl>
                    <p className={styles.workflowRecommendation}>{step.recommendation}</p>
                    {step.actions.length > 0 && (
                      <div className={styles.workflowActions}>
                        {step.actions.map(action => {
                          const actionState = actionStates[action.id]
                          const disabled = action.disabled || actionState?.loading === true
                          return (
                            <div key={action.id} className={styles.workflowActionGroup}>
                              <button
                                className={`${styles.btn} ${styles.btnPrimary}`}
                                type="button"
                                disabled={disabled}
                                onClick={() => void runAction(action.id)}
                              >
                                {actionState?.loading ? 'Working…' : action.label}
                              </button>
                              {action.disabledReason && <span className={styles.muted}>{action.disabledReason}</span>}
                              {actionState?.feedback && (
                                <span className={actionState.isError ? styles.errorMsg : styles.muted} role={actionState.isError ? 'alert' : 'status'}>
                                  {actionState.feedback}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </section>

            <details className={styles.helpPanel}>
              <summary>What this workflow does</summary>
              <div className={styles.helpBody}>
                <ol>
                  <li><strong>Scrape sources</strong> gets fresh listing records from active source websites.</li>
                  <li><strong>Process details</strong> crawls listing detail pages and extracts WAV-specific fields.</li>
                  <li><strong>Geocode missing locations</strong> adds coordinates so listings can appear as map pins.</li>
                  <li><strong>Sync search index</strong> copies the latest database rows into Meilisearch.</li>
                  <li><strong>Verify readiness</strong> checks that search is available and active listings have map coordinates.</li>
                </ol>
                <p>The <Link href="/ops/queues" style={{ color: 'var(--clr-primary)' }}>raw queues page</Link> remains available for advanced job inspection, retries, and Bull Board access.</p>
              </div>
            </details>
          </>
        )}
      </div>
    </main>
  )
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  return res.json() as Promise<T>
}

async function postJson<T = unknown>(url: string, data?: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data === undefined ? {} : { data }),
  })
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  return res.json() as Promise<T>
}

function statusVariant(status: WorkflowStepStatus): string {
  if (status === 'complete') return 'success'
  if (status === 'running') return 'neutral'
  if (status === 'warning') return 'warning'
  if (status === 'blocked') return 'danger'
  return 'neutral'
}

function statusLabel(status: WorkflowStepStatus): string {
  if (status === 'complete') return 'Ready'
  if (status === 'actionable') return 'Next action'
  if (status === 'running') return 'Running'
  if (status === 'warning') return 'Needs attention'
  return 'Blocked'
}

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}
