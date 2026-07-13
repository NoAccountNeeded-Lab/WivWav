'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RelativeTimestamp } from '@/lib/relative-time'
import styles from '../../ops.module.css'
import { stageStatus, stageStatusLabel, type PipelineStage } from './source-pipeline-helpers'

interface PipelineResponse {
  source: { id: string; name: string }
  generatedAt: string
  stages: PipelineStage[]
}

interface SourcePipelineClientProps {
  apiBaseUrl: string
  sourceId: string
}

interface RetryState {
  loading: boolean
  feedback: string | null
  isError: boolean
}

interface ExplainState {
  loading: boolean
  explanation: string | null
  error: string | null
}

const REFRESH_MS = 15_000
// Ollama completions can be slow on CPU-only hosts; bounded so the panel
// shows a clear error state instead of hanging indefinitely if the daemon
// is unreachable or stalls (see #552 fetchWithTimeout pattern).
const EXPLAIN_TIMEOUT_MS = 35_000

const STAGE_META: Record<string, { label: string; description: string }> = {
  'source-scrape': {
    label: 'Source scrape',
    description: 'Fetches the listing index page(s) from this source and upserts listings.',
  },
  'detail-crawl': {
    label: 'Detail crawl',
    description: 'Uses Playwright to open each listing detail URL and store the raw HTML.',
  },
  'detail-extract': {
    label: 'Detail extract',
    description: 'Parses stored detail HTML to extract WAV-specific fields — no network calls.',
  },
  'geocode': {
    label: 'Geocode',
    description: 'Converts city + state to GPS coordinates. Runs across all sources, not scoped to this one.',
  },
  'vin-enrich': {
    label: 'VIN enrich',
    description: 'Decodes VINs via NHTSA vPIC and links listings to vehicle models. Runs across all sources.',
  },
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

export function SourcePipelineClient({ apiBaseUrl, sourceId }: SourcePipelineClientProps) {
  const [data, setData] = useState<PipelineResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [retryStates, setRetryStates] = useState<Record<string, RetryState>>({})
  const [explainStates, setExplainStates] = useState<Record<string, ExplainState>>({})

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sources/${encodeURIComponent(sourceId)}/pipeline`, { cache: 'no-store' })
      if (res.status === 404) {
        setNotFound(true)
        setError(null)
        return
      }
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: PipelineResponse }
      setData(body.data)
      setNotFound(false)
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pipeline status')
    } finally {
      setIsRefreshing(false)
    }
  }, [apiBaseUrl, sourceId])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  async function retryFailed(stage: PipelineStage) {
    setRetryStates(prev => ({ ...prev, [stage.stage]: { loading: true, feedback: null, isError: false } }))
    try {
      const body = stage.failedScopedToSource ? { data: { sourceId } } : { data: {} }
      const res = await fetch(`${apiBaseUrl}/admin/queues/${encodeURIComponent(stage.queue)}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const responseBody = (await res.json()) as { data: { id: string } }
      setRetryStates(prev => ({
        ...prev,
        [stage.stage]: { loading: false, feedback: `Re-enqueued (${responseBody.data.id})`, isError: false },
      }))
      setTimeout(() => void refresh(), 1000)
    } catch (err) {
      setRetryStates(prev => ({
        ...prev,
        [stage.stage]: { loading: false, feedback: err instanceof Error ? err.message : 'Error', isError: true },
      }))
    }
  }

  async function explainError(stage: PipelineStage) {
    if (!stage.latestFailedJobId) return
    setExplainStates(prev => ({ ...prev, [stage.stage]: { loading: true, explanation: null, error: null } }))
    try {
      const res = await fetch(`${apiBaseUrl}/admin/ai/explain-error`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(EXPLAIN_TIMEOUT_MS),
        body: JSON.stringify({ data: { queue: stage.queue, jobId: stage.latestFailedJobId } }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message ?? `Explain request failed (${res.status})`)
      }
      const body = (await res.json()) as { data: { explanation: string } }
      setExplainStates(prev => ({
        ...prev,
        [stage.stage]: { loading: false, explanation: body.data.explanation, error: null },
      }))
    } catch (err) {
      const message = err instanceof Error && err.name === 'TimeoutError'
        ? 'Ollama did not respond in time. Confirm it is running and try again.'
        : err instanceof Error ? err.message : 'Failed to get an explanation'
      setExplainStates(prev => ({ ...prev, [stage.stage]: { loading: false, explanation: null, error: message } }))
    }
  }

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>{data ? data.source.name : 'Source pipeline'}</h1>
            <p className={styles.pageIntro}>
              Live per-stage pending, failed, and stall state for this source&apos;s ingest pipeline.
            </p>
          </div>
          <Link href="/ops/sources" className={styles.backLink}>← Sources</Link>
        </div>

        <div className={styles.controlsBar}>
          <span className={styles.refreshMeta}>
            {updatedAt ? `Updated ${fmtTime(updatedAt)}` : 'Loading…'}
          </span>
          <div className={styles.controlsBarRight}>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => void refresh()} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {notFound ? (
          <p className={styles.error}>Source &quot;{sourceId}&quot; was not found. Check the Sources page for valid source IDs.</p>
        ) : error ? (
          <p className={styles.error}>Pipeline status could not load: {error}. Check the API, then refresh this page.</p>
        ) : !data ? (
          <p className={styles.empty}>Loading pipeline status. If this does not finish, confirm the API is running and refresh.</p>
        ) : (
          <div className={styles.pipelineStrip}>
            {data.stages.map(stage => {
              const meta = STAGE_META[stage.stage]
              const status = stageStatus(stage)
              const rs = retryStates[stage.stage]
              return (
                <article key={stage.stage} className={styles.pipelineStage} data-status={status}>
                  <div className={styles.pipelineStageTop}>
                    <span className={styles.pipelineStageName}>{meta?.label ?? stage.stage}</span>
                    <span
                      className={styles.badge}
                      data-variant={status === 'failed' ? 'danger' : status === 'stalled' ? 'warning' : stage.pendingCount > 0 ? 'success' : 'neutral'}
                    >
                      {stageStatusLabel(stage)}
                    </span>
                  </div>
                  {meta && <p className={styles.muted} style={{ fontSize: '0.8125rem' }}>{meta.description}</p>}
                  <div className={styles.pipelineStageMetrics}>
                    <div className={styles.metric}>
                      <span className={styles.metricLabel}>Pending</span>
                      <span className={styles.metricValue}>{stage.pendingCount.toLocaleString()}</span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricLabel}>Failed{stage.failedScopedToSource ? '' : ' (all sources)'}</span>
                      <span className={styles.metricValue} style={stage.failedCount > 0 ? { color: 'var(--clr-danger-text)' } : undefined}>
                        {stage.failedCount.toLocaleString()}
                      </span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricLabel}>Last completed</span>
                      <span className={styles.metricValue} style={{ fontSize: '0.875rem' }}>
                        <RelativeTimestamp value={stage.lastCompletedAt} fallback="Never" />
                      </span>
                    </div>
                  </div>
                  {stage.failedCount > 0 && (
                    <div className={styles.actions}>
                      <button
                        className={`${styles.btn} ${styles.btnDanger}`}
                        type="button"
                        disabled={rs?.loading}
                        onClick={() => void retryFailed(stage)}
                        aria-label={`Retry failed ${meta?.label ?? stage.stage} jobs`}
                      >
                        {rs?.loading ? 'Retrying…' : 'Retry failed jobs'}
                      </button>
                      {stage.latestFailedJobId && (
                        <button
                          className={`${styles.btn} ${styles.btnGhost}`}
                          type="button"
                          disabled={explainStates[stage.stage]?.loading}
                          onClick={() => void explainError(stage)}
                          aria-label={`Explain this error for ${meta?.label ?? stage.stage}`}
                        >
                          {explainStates[stage.stage]?.loading ? 'Asking Ollama…' : 'Explain this error'}
                        </button>
                      )}
                      {rs?.feedback && (
                        <span className={rs.isError ? styles.errorMsg : styles.muted} style={{ fontSize: '0.75rem' }}>
                          {rs.feedback}
                        </span>
                      )}
                    </div>
                  )}
                  {explainStates[stage.stage]?.error && (
                    <p className={styles.errorMsg} role="alert">
                      {explainStates[stage.stage]?.error}
                    </p>
                  )}
                  {explainStates[stage.stage]?.explanation && (
                    <div className={styles.aiExplainPanel} role="status">
                      <p className={styles.aiExplainLabel}>AI-generated explanation (Ollama) — not a verified fix</p>
                      <p className={styles.aiExplainText}>{explainStates[stage.stage]?.explanation}</p>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}

        <details className={styles.helpPanel}>
          <summary>How to read this page</summary>
          <div className={styles.helpBody}>
            <p>Each tile is one stage of the ingest pipeline for this source, left to right (or top to bottom on mobile) in processing order.</p>
            <p><strong>Pending</strong> is the count of items still waiting for that stage&apos;s work, derived directly from the database (mirrors what the next job run would pick up).</p>
            <p><strong>Failed</strong> is the count of failed BullMQ jobs for that stage&apos;s queue. For detail-crawl and detail-extract this is scoped to this source; geocode and vin-enrich run globally, so their failed count covers all sources.</p>
            <p><strong>Stalled</strong> means pending work exists but the stage hasn&apos;t completed anything within the expected window — distinct from active failures, which show as <strong>Failing</strong> instead.</p>
            <p><strong>Retry failed jobs</strong> re-enqueues work for that stage via the same endpoint used elsewhere in ops (for source-scoped stages, scoped to this source only).</p>
          </div>
        </details>
      </div>
    </main>
  )
}
