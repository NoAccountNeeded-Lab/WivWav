'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { OpsProgressDeterminate, OpsProgressIndeterminate } from '@/components/OpsProgress'
import { OpsRunbooks } from '../OpsRunbooks'
import styles from '../ops.module.css'
import { buildJobProgressModel, buildQueueSnapshotProgress } from './progress'
import { QUEUE_RUNBOOK_IDS } from '../runbooks'

interface QueueStats {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

interface QueuePolicy {
  concurrency: number
  retention: {
    completed: number
    failed: number
  }
}

interface QueueRow {
  name: string
  paused: boolean
  stats: QueueStats
  policy: QueuePolicy
}

interface JobRecord {
  id: string
  name: string
  data: unknown
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
  createdAt: string
  finishedAt?: string
  failedReason?: string
  attemptsMade: number
  progress: unknown
  logs: string[]
}

interface QueueDetail extends QueueRow {
  jobs: JobRecord[]
}

interface QueueMeta {
  short: string
  detail: string
  canTrigger: boolean
}

const QUEUE_META: Record<string, QueueMeta> = {
  'source-scrape': {
    short: 'Fetches listing pages from a data source (BLVD.com, MobilityWorks)',
    detail: 'Triggered per-source on a cron schedule or manually. Use the Sources page to trigger a specific source immediately.',
    canTrigger: false,
  },
  'detail-crawl': {
    short: 'Loads full listing detail pages via Playwright and stores the raw HTML',
    detail: 'Finds listings that haven\'t had their detail page fetched yet. Rate-limited to one page every 2 seconds to be polite to source sites. Runs hourly.',
    canTrigger: true,
  },
  'detail-extract': {
    short: 'Parses stored HTML to extract WAV-specific fields (ramp, lift, wheelchair capacity)',
    detail: 'Reads from the raw_pages table — no network calls. Processes up to 100 pages per job run. Runs every 5 minutes.',
    canTrigger: true,
  },
  'geocode': {
    short: 'Converts city + state to GPS coordinates using OpenStreetMap Nominatim',
    detail: 'Finds listings with a null lat/lng. Rate-limited to 1 request per 1.1 seconds per Nominatim\'s usage policy. Runs nightly at 2 AM.',
    canTrigger: true,
  },
  'deduplicate': {
    short: 'Finds vehicles appearing across multiple sources and assigns one vehicle identity',
    detail: 'Matches by VIN. Assigns the same vehicle identity to cross-listed rows so search can show one card per vehicle. Runs nightly at 3 AM.',
    canTrigger: true,
  },
  'vin-enrich': {
    short: 'Decodes listing VINs through NHTSA vPIC and links listings to vehicle models',
    detail: 'Refreshes every 6 hours starting at 4 AM. Recent failures indicate VIN decode or model upsert problems before downstream NHTSA refresh jobs run.',
    canTrigger: true,
  },
  'nhtsa-recalls': {
    short: 'Refreshes NHTSA recall records for vehicle models currently in inventory',
    detail: 'Runs daily at 4:30 AM after VIN enrichment. Use Activity to verify the latest run, job logs, and failed API/model refresh attempts.',
    canTrigger: true,
  },
  'nhtsa-complaints': {
    short: 'Refreshes NHTSA complaint records for vehicle models currently in inventory',
    detail: 'Runs weekly on Sunday at 5 AM. Use Activity to inspect recent failures and the per-model refresh log output.',
    canTrigger: true,
  },
  'nhtsa-safety-ratings': {
    short: 'Refreshes NHTSA safety ratings for vehicle models currently in inventory',
    detail: 'Runs weekly on Sunday at 6 AM. Use Activity to inspect rating lookup progress and failures.',
    canTrigger: true,
  },
  'nhtsa-investigations': {
    short: 'Refreshes NHTSA safety investigation records for vehicle models in inventory',
    detail: 'Queries the NHTSA investigations API per vehicle model. Runs weekly on Sunday at 6:30 AM after safety ratings. Rate-limited to 300 ms between requests.',
    canTrigger: true,
  },
  'nhtsa-manufacturer-communications': {
    short: 'Refreshes NHTSA Technical Service Bulletins (TSBs) for vehicle models in inventory',
    detail: 'Fetches TSBs from the NHTSA API per vehicle model. Runs weekly on Sunday at 7 AM. Use Activity to inspect per-model refresh progress and failures.',
    canTrigger: true,
  },
  'dealer-enrich': {
    short: 'Enriches dealer records with Google Places data (hours, reviews, photos)',
    detail: 'Processes up to 50 dealers per run (2 API requests each) to stay within the 100 req/day free-tier budget. Re-enriches dealers older than 30 days. Runs nightly at 7 AM.',
    canTrigger: true,
  },
  'vehicle-stats-refresh': {
    short: 'Seeds vehicle reliability and lifespan statistics from a curated dataset',
    detail: 'Loads vehicle stats (avg lifespan, reliability scores, J.D. Power data) from a bundled seed file into the database. Runs weekly on Sunday at 1 AM. Safe to re-trigger; upserts on make/model/year.',
    canTrigger: true,
  },
  'model-research': {
    short: 'Fetches EPA fuel economy specs (MPG, drivetrain, engine, transmission) for vehicle models',
    detail: 'Calls the public EPA FuelEconomy.gov API — no key required. Stores claims with source URLs for display on listing detail pages. Runs weekly on Sunday at 5:30 AM.',
    canTrigger: true,
  },
  'listing-sync': {
    short: 'Syncs listing changes from Postgres into the Meilisearch search index',
    detail: 'Read-only index rebuild — no writes to listing rows. Runs nightly at 1:30 AM. Also triggered by geocode and VIN enrichment jobs when coordinates or vehicle model links change. Use "Sync Meilisearch" above to trigger immediately.',
    canTrigger: true,
  },
  'rawpage-cleanup': {
    short: 'Deletes stale raw HTML pages from the raw_pages table',
    detail: 'Removes processed pages older than 7 days and unprocessed pages older than 30 days. Runs nightly at midnight before other pipeline jobs. No listing writes.',
    canTrigger: true,
  },
  'conversion-brands-seed': {
    short: 'Seeds WAV conversion brand and product data from a curated JSON dataset',
    detail: 'Loads conversion brands (e.g. BraunAbility, VMI) and their products into the database from a bundled seed file. Runs weekly on Sunday at 1:15 AM. Safe to re-trigger; upserts on name.',
    canTrigger: true,
  },
  'nmeda-dealers-seed': {
    short: 'Seeds NMEDA-certified dealer records from a curated JSON dataset',
    detail: 'Loads NMEDA dealer contact and certification data from a bundled seed file into the database. Runs weekly on Sunday at 1:20 AM. Safe to re-trigger; upserts on name.',
    canTrigger: true,
  },
  'fueleconomy-msrp': {
    short: 'Fetches MSRP data from the U.S. DOE FuelEconomy.gov API for vehicle models',
    detail: 'Stores base MSRP values with source attribution for display on listing pages. Rate-limited to 300 ms between requests to be polite to government infrastructure. Runs weekly on Sunday at 7:30 AM.',
    canTrigger: true,
  },
}

interface ActionState {
  loading: boolean
  feedback: string | null
  isError: boolean
}

interface QueuesClientProps {
  apiBaseUrl: string
}

const REFRESH_MS = 15_000

export function QueuesClient({ apiBaseUrl }: QueuesClientProps) {
  const [queues, setQueues] = useState<QueueRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null)
  const [queueDetail, setQueueDetail] = useState<QueueDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<ActionState>({ loading: false, feedback: null, isError: false })

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch(`${apiBaseUrl}/admin/queues`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: QueueRow[] }
      setQueues(body.data)
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queues')
    } finally {
      setIsRefreshing(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  const refreshQueueDetail = useCallback(async (name: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/admin/queues/${encodeURIComponent(name)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: QueueDetail }
      setQueueDetail(body.data)
      setDetailError(null)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load queue activity')
    }
  }, [apiBaseUrl])

  useEffect(() => {
    if (!selectedQueue) return
    void refreshQueueDetail(selectedQueue)
    const interval = window.setInterval(() => void refreshQueueDetail(selectedQueue), 3000)
    return () => window.clearInterval(interval)
  }, [refreshQueueDetail, selectedQueue])

  function setAction(name: string, state: ActionState) {
    setActionStates(prev => ({ ...prev, [name]: state }))
  }

  async function pauseQueue(name: string) {
    setAction(name, { loading: true, feedback: null, isError: false })
    try {
      const res = await fetch(`${apiBaseUrl}/admin/queues/${encodeURIComponent(name)}/pause`, { method: 'POST' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setQueues(prev => prev?.map(q => q.name === name ? { ...q, paused: true } : q) ?? null)
      setAction(name, { loading: false, feedback: 'Paused', isError: false })
    } catch (err) {
      setAction(name, { loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true })
    }
  }

  async function resumeQueue(name: string) {
    setAction(name, { loading: true, feedback: null, isError: false })
    try {
      const res = await fetch(`${apiBaseUrl}/admin/queues/${encodeURIComponent(name)}/resume`, { method: 'POST' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setQueues(prev => prev?.map(q => q.name === name ? { ...q, paused: false } : q) ?? null)
      setAction(name, { loading: false, feedback: 'Resumed', isError: false })
    } catch (err) {
      setAction(name, { loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true })
    }
  }

  async function triggerSync() {
    setSyncState({ loading: true, feedback: null, isError: false })
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sync`, { method: 'POST' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const body = (await res.json()) as { data: { enqueued: boolean; jobId: string } }
      setSyncState({ loading: false, feedback: `Sync queued (job ${body.data.jobId})`, isError: false })
    } catch (err) {
      setSyncState({ loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true })
    }
  }

  async function triggerQueue(name: string) {
    setAction(name, { loading: true, feedback: null, isError: false })
    try {
      const res = await fetch(`${apiBaseUrl}/admin/queues/${encodeURIComponent(name)}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const body = (await res.json()) as { data: { id: string } }
      setAction(name, { loading: false, feedback: `Enqueued job ${body.data.id}`, isError: false })
      setTimeout(() => void refresh(), 1000)
    } catch (err) {
      setAction(name, { loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true })
    }
  }

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Advanced queue diagnostics</h1>
            <p className={styles.pageIntro}>
              Inspect raw background jobs, trigger maintenance work, and sync listing changes into search.
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
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <a href="/admin/board" target="_blank" rel="noopener noreferrer" className={`${styles.btn} ${styles.btnGhost}`}>
              Bull Board diagnostics ↗
            </a>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              onClick={() => void triggerSync()}
              disabled={syncState.loading}
            >
              {syncState.loading ? 'Syncing…' : 'Sync Meilisearch'}
            </button>
          </div>
        </div>
        {syncState.feedback && (
          <p className={syncState.isError ? styles.errorMsg : styles.muted} style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
            {syncState.feedback}
          </p>
        )}

        <OpsRunbooks ids={QUEUE_RUNBOOK_IDS} />

        {error ? (
          <p className={styles.error}>
            Queue diagnostics could not load: {error}. Check that the API and worker services are running, then refresh this page.
          </p>
        ) : !queues ? (
          <p className={styles.empty}>Loading queue diagnostics. If this takes more than a few seconds, confirm the API is running and refresh.</p>
        ) : queues.length === 0 ? (
          <p className={styles.empty}>No background job queues were returned. Start the worker stack, then refresh diagnostics.</p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Status</th>
                  <th className={styles.num}>Waiting</th>
                  <th className={styles.num}>Active</th>
                  <th className={styles.num}>Delayed</th>
                  <th className={styles.num}>Completed</th>
                  <th className={styles.num}>Failed</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {queues.map(q => {
                  const meta = QUEUE_META[q.name]
                  const act = actionStates[q.name]
                  const isImpl = !!meta
                  const isExpanded = selectedQueue === q.name
                  return (
                    <Fragment key={q.name}>
                      <tr className={isImpl ? undefined : styles.dimRow}>
                        <td>
                          <div className={styles.queueNameWrap}>
                            <div className={styles.queueName}>
                              <code style={{ fontSize: '0.8125rem' }}>{q.name}</code>
                              {meta && (
                                // Not a control (no click/keydown handler): tabIndex makes it
                                // focusable so :focus CSS reveals the tooltip for keyboard
                                // users the same way :hover does for pointer users. aria-label
                                // already exposes the short description to assistive tech.
                                <span
                                  className={styles.tip}
                                  data-tip={`${meta.short}\n\n${meta.detail}`}
                                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                                  tabIndex={0}
                                  aria-label={`Info: ${meta.short}`}
                                >?</span>
                              )}
                            </div>
                            {meta && <div className={styles.queueDesc}>{meta.short}</div>}
                            <div className={styles.queueDesc}>
                              concurrency {q.policy.concurrency} · keep {q.policy.retention.completed} completed / {q.policy.retention.failed} failed
                            </div>
                            {(() => {
                              const progress = buildQueueSnapshotProgress(q.stats)
                              return progress ? (
                                <div className={styles.queueProgress}>
                                  <OpsProgressDeterminate
                                    value={progress.value}
                                    min={0}
                                    max={progress.max}
                                    label={`${q.name} queue snapshot progress`}
                                    caption={progress.caption}
                                  />
                                  <span className={styles.queueProgressMeta}>{progress.statusText}</span>
                                </div>
                              ) : (
                                <div className={styles.queueProgress}>
                                  <span className={styles.queueProgressMeta}>No visible jobs in this snapshot yet.</span>
                                </div>
                              )
                            })()}
                            {!meta && <div className={styles.queueDesc}>Not yet implemented</div>}
                          </div>
                        </td>
                        <td>
                          <span
                            className={styles.badge}
                            data-variant={q.paused ? 'paused' : q.stats.active > 0 ? 'success' : 'neutral'}
                          >
                            {q.paused ? 'Paused' : q.stats.active > 0 ? 'Active' : 'Idle'}
                          </span>
                        </td>
                        <td className={styles.num}>{q.stats.waiting}</td>
                        <td className={styles.num}>{q.stats.active}</td>
                        <td className={styles.num}>{q.stats.delayed}</td>
                        <td className={styles.num}>{q.stats.completed}</td>
                        <td className={styles.num}>
                          {q.stats.failed > 0
                            ? <span style={{ color: 'var(--clr-danger-text)', fontWeight: 600 }}>{q.stats.failed}</span>
                            : 0}
                        </td>
                        <td>
                          {isImpl && (
                            <div className={styles.actions}>
                              {q.paused ? (
                                <button
                                  className={`${styles.btn} ${styles.btnPrimary}`}
                                  type="button"
                                  disabled={act?.loading}
                                  onClick={() => void resumeQueue(q.name)}
                                >
                                  Resume
                                </button>
                              ) : (
                                <button
                                  className={`${styles.btn} ${styles.btnGhost}`}
                                  type="button"
                                  disabled={act?.loading}
                                  onClick={() => void pauseQueue(q.name)}
                                >
                                  Pause
                                </button>
                              )}
                              {meta.canTrigger && (
                                <button
                                  className={`${styles.btn} ${styles.btnGhost}`}
                                  type="button"
                                  disabled={act?.loading}
                                  onClick={() => void triggerQueue(q.name)}
                                >
                                  Trigger
                                </button>
                              )}
                              <button
                                className={`${styles.btn} ${isExpanded ? styles.btnPrimary : styles.btnGhost}`}
                                type="button"
                                onClick={() => setSelectedQueue(prev => prev === q.name ? null : q.name)}
                              >
                                Activity
                              </button>
                              {act?.feedback && (
                                <span className={act.isError ? styles.errorMsg : styles.muted} style={{ fontSize: '0.75rem' }}>
                                  {act.feedback}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className={styles.expandedRow}>
                          <td colSpan={8}>
                            <div className={styles.activityHeader}>
                              <div>
                                <h2 className={styles.activityTitle}>{q.name} activity</h2>
                                <p className={styles.activityMeta}>Auto-refreshes every 3 s</p>
                              </div>
                              <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => void refreshQueueDetail(q.name)}>
                                Refresh
                              </button>
                            </div>
                            {detailError ? (
                              <p className={`${styles.error}`} style={{ margin: '1rem' }}>
                                Activity could not load: {detailError}. Retry with Refresh or open Bull Board diagnostics for raw job details.
                              </p>
                            ) : !queueDetail || queueDetail.name !== q.name ? (
                              <p className={styles.empty} style={{ padding: '1rem' }}>Loading recent activity for this queue.</p>
                            ) : queueDetail.jobs.length === 0 ? (
                              <p className={styles.empty} style={{ padding: '1rem' }}>No recent jobs. Trigger a supported job or wait for the next schedule, then refresh activity.</p>
                            ) : (
                              <div className={styles.jobList}>
                                {queueDetail.jobs.map(job => (
                                  <article key={job.id} className={styles.jobItem}>
                                    <div className={styles.jobTopline}>
                                      <code className={styles.jobId}>#{job.id}</code>
                                      <span className={styles.badge} data-variant={job.status === 'failed' ? 'danger' : job.status === 'active' ? 'success' : 'neutral'}>
                                        {job.status}
                                      </span>
                                      <span className={styles.muted}>attempts {job.attemptsMade}</span>
                                      <span className={styles.muted}>{fmtDateTime(job.createdAt)}</span>
                                    </div>
                                    <div className={styles.jobGrid}>
                                      <div>
                                        <h3 className={styles.jobSubhead}>Progress</h3>
                                        {(() => {
                                          const progress = buildJobProgressModel(job)
                                          if (progress.kind === 'determinate') {
                                            return (
                                              <div className={styles.jobProgress}>
                                                <OpsProgressDeterminate
                                                  value={progress.value}
                                                  min={0}
                                                  max={progress.max}
                                                  label={progress.label}
                                                  caption={progress.caption}
                                                />
                                              </div>
                                            )
                                          }

                                          if (progress.kind === 'indeterminate') {
                                            return (
                                              <div className={styles.jobProgress}>
                                                <OpsProgressIndeterminate statusText={progress.statusText} />
                                              </div>
                                            )
                                          }

                                          return null
                                        })()}
                                        <pre className={styles.miniCode}>{formatUnknown(job.progress)}</pre>
                                      </div>
                                      <div>
                                        <h3 className={styles.jobSubhead}>Payload</h3>
                                        <pre className={styles.miniCode}>{formatUnknown(job.data)}</pre>
                                      </div>
                                    </div>
                                    {job.failedReason && <p className={styles.errorMsg}>{job.failedReason}</p>}
                                    <div>
                                      <h3 className={styles.jobSubhead}>Logs</h3>
                                      {job.logs.length === 0 ? (
                                        <p className={styles.muted}>No logs yet.</p>
                                      ) : (
                                        <ol className={styles.logList}>
                                          {job.logs.map((line, i) => <li key={`${job.id}-${i}`}>{line}</li>)}
                                        </ol>
                                      )}
                                    </div>
                                  </article>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <details className={styles.helpPanel}>
          <summary>How advanced queue diagnostics work</summary>
          <div className={styles.helpBody}>
            <p>WivWav runs listing refresh work as background jobs so operators can trigger or pause maintenance without restarting the app.</p>
            <ol>
              <li><strong>source-scrape</strong> — Fetches listing pages from each source. Triggered by cron or "Run Now" on the Sources page. Produces listings in the database.</li>
              <li><strong>detail-crawl</strong> — Uses Playwright to open individual listing URLs and store raw HTML. Triggered hourly by cron.</li>
              <li><strong>detail-extract</strong> — Parses the stored HTML to pull out WAV-specific fields (ramp type, lift, controls, etc.). Runs every 5 minutes.</li>
              <li><strong>geocode</strong> — Resolves city + state to GPS coordinates using Nominatim (OpenStreetMap). Deduplicates by unique location — each city/state is looked up once regardless of how many listings share it. Runs nightly at 2 AM.</li>
              <li><strong>deduplicate</strong> — Finds the same vehicle listed at multiple sources (matched by VIN) and assigns one vehicle identity across those rows. Runs nightly at 3 AM.</li>
              <li><strong>vin-enrich</strong> — Decodes VINs through NHTSA vPIC and links listings to vehicle models. Runs every 6 hours starting at 4 AM.</li>
              <li><strong>nhtsa-recalls</strong> — Refreshes recall data for inventory vehicle models. Runs daily at 4:30 AM.</li>
              <li><strong>nhtsa-complaints</strong> — Refreshes complaint data for inventory vehicle models. Runs weekly Sunday at 5 AM.</li>
              <li><strong>nhtsa-safety-ratings</strong> — Refreshes safety ratings for inventory vehicle models. Runs weekly Sunday at 6 AM.</li>
            </ol>
            <p><strong>After geocoding completes, click "Sync Meilisearch"</strong> (top right) to push the new coordinates into the search index — that&apos;s what makes pins appear on the map. Geocode updates Postgres; sync copies it to Meilisearch.</p>
            <p><strong>Pausing</strong> a queue stops workers from picking up new jobs — jobs already in progress finish. <strong>Triggering</strong> enqueues a job immediately without waiting for the cron schedule.</p>
            <p>For raw queue internals such as job payloads, retry counts, and stack traces, open <a href="/admin/board" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--clr-primary)' }}>Bull Board diagnostics ↗</a>.</p>
          </div>
        </details>
      </div>
    </main>
  )
}

function fmtDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatUnknown(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'none'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}
