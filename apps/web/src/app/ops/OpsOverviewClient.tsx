'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { HealthResponse } from '@wivwav/types'
import styles from './page.module.css'
import {
  buildOpsOverview,
  type OverviewModel,
  type QueueRow,
  type RunRow,
  type ScheduleEntry,
  type SourceRow,
} from './overview-helpers'
import { OpsRunbooks } from './OpsRunbooks'
import { OPS_RUNBOOK_IDS } from './runbooks'

interface OpsOverviewClientProps {
  apiBaseUrl: string
}

interface OverviewData {
  health: HealthResponse | null
  queues: QueueRow[] | null
  sources: SourceRow[] | null
  runs: RunRow[] | null
  schedules: ScheduleEntry[] | null
  errors: Partial<Record<'health' | 'queues' | 'sources' | 'runs' | 'schedules', string>>
}

const REFRESH_MS = 30_000

const OPS_LINKS = [
  { href: '/ops/queues', label: 'Queues', detail: 'Inspect jobs, trigger geocode, and sync Meilisearch.' },
  { href: '/ops/sources', label: 'Sources', detail: 'Run scrapes and review source remapping status.' },
  { href: '/ops/runs', label: 'Runs', detail: 'Audit scraper run history and listing changes.' },
  { href: '/ops/schedules', label: 'Schedules', detail: 'Enable, disable, or edit repeatable jobs.' },
  { href: '/ops/logs', label: 'Logs', detail: 'Search application and worker logs.' },
  { href: '/ops/ai', label: 'AI', detail: 'Check Ollama and remapping support.' },
  { href: '/ops/config', label: 'AI Config', detail: 'Manage AI providers, models, and secrets.' },
  { href: '/status', label: 'System Status', detail: 'View raw service health details.' },
]

export function OpsOverviewClient({ apiBaseUrl }: OpsOverviewClientProps) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    const [health, queues, sources, runs, schedules] = await Promise.all([
      fetchData<HealthResponse>(`${apiBaseUrl}/health`),
      fetchData<QueueRow[]>(`${apiBaseUrl}/admin/queues`),
      fetchData<SourceRow[]>(`${apiBaseUrl}/admin/sources`),
      fetchData<RunRow[]>(`${apiBaseUrl}/admin/runs`),
      fetchData<ScheduleEntry[]>(`${apiBaseUrl}/admin/repeatables`),
    ])

    setData({
      health: health.data,
      queues: queues.data,
      sources: sources.data,
      runs: runs.data,
      schedules: schedules.data,
      errors: {
        ...(health.error ? { health: health.error } : {}),
        ...(queues.error ? { queues: queues.error } : {}),
        ...(sources.error ? { sources: sources.error } : {}),
        ...(runs.error ? { runs: runs.error } : {}),
        ...(schedules.error ? { schedules: schedules.error } : {}),
      },
    })
    setUpdatedAt(new Date())
    setIsRefreshing(false)
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  const overview = useMemo<OverviewModel | null>(() => {
    if (!data) return null
    return buildOpsOverview({ ...data, now: updatedAt ?? new Date() })
  }, [data, updatedAt])

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <header className={styles.hero}>
          <div>
            <p className={styles.kicker}>Operator overview</p>
            <h1 className={styles.heading}>Is WivWav healthy right now?</h1>
            <p className={styles.subheading}>
              Site health, listing freshness, scraper status, and next actions from the existing operations data.
            </p>
          </div>
          <div className={styles.refreshPanel}>
            <p className={styles.updatedAt} aria-live="polite">
              {updatedAt ? `Updated ${formatTime(updatedAt)}` : 'Loading overview...'}
            </p>
            <button className={styles.refreshButton} type="button" onClick={() => void refresh()} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </header>

        {!overview ? (
          <section className={styles.loadingPanel} aria-live="polite">
            Loading operator overview...
          </section>
        ) : (
          <>
            <section className={styles.summaryBand} data-severity={overview.overall.severity} aria-labelledby="overview-summary-heading">
              <div>
                <h2 id="overview-summary-heading" className={styles.summaryTitle}>{overview.overall.label}</h2>
                <p className={styles.summaryDetail}>{overview.overall.detail}</p>
              </div>
              <span className={styles.statusPill} data-severity={overview.overall.severity}>
                Status: {formatSeverity(overview.overall.severity)}
              </span>
            </section>

            <section className={styles.section} aria-labelledby="attention-heading">
              <div className={styles.sectionHeader}>
                <h2 id="attention-heading" className={styles.sectionTitle}>Attention Needed</h2>
                <Link href="/ops/logs" className={styles.inlineLink}>Open logs</Link>
              </div>
              <div className={styles.attentionList}>
                {overview.attention.map(item => (
                  <Link key={item.id} href={item.href} className={styles.attentionItem} data-severity={item.severity}>
                    <span className={styles.attentionBadge} data-severity={item.severity}>{formatSeverity(item.severity)}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="health-heading">
              <div className={styles.sectionHeader}>
                <h2 id="health-heading" className={styles.sectionTitle}>Service And Queue Health</h2>
                <Link href="/status" className={styles.inlineLink}>Raw status</Link>
              </div>
              <CardGrid cards={overview.healthCards} />
            </section>

            <section className={styles.section} aria-labelledby="freshness-heading">
              <div className={styles.sectionHeader}>
                <h2 id="freshness-heading" className={styles.sectionTitle}>Listing Freshness</h2>
                <Link href="/ops/runs" className={styles.inlineLink}>Scraper runs</Link>
              </div>
              <CardGrid cards={overview.freshnessCards} />
            </section>

            <section className={styles.section} aria-labelledby="telemetry-heading">
              <div className={styles.sectionHeader}>
                <h2 id="telemetry-heading" className={styles.sectionTitle}>Telemetry Gaps</h2>
              </div>
              <CardGrid cards={overview.telemetry} />
            </section>
          </>
        )}

        <nav className={styles.linkGrid} aria-label="Operations areas">
          {OPS_LINKS.map(link => (
            <Link key={link.href} href={link.href} className={styles.areaLink}>
              <strong>{link.label}</strong>
              <span>{link.detail}</span>
            </Link>
          ))}
        </nav>

        <OpsRunbooks ids={OPS_RUNBOOK_IDS} />
      </div>
    </main>
  )
}

function CardGrid({ cards }: { cards: OverviewModel['healthCards'] }) {
  return (
    <div className={styles.metricGrid}>
      {cards.map(card => {
        const content = (
          <>
            <span className={styles.metricTopline}>
              <span className={styles.metricLabel}>{card.label}</span>
              <span className={styles.statusPill} data-severity={card.severity}>{formatSeverity(card.severity)}</span>
            </span>
            <strong className={styles.metricValue}>{card.value}</strong>
            <span className={styles.metricDetail}>{card.detail}</span>
          </>
        )

        return card.href ? (
          <Link key={card.id} href={card.href} className={styles.metricCard} data-severity={card.severity}>
            {content}
          </Link>
        ) : (
          <article key={card.id} className={styles.metricCard} data-severity={card.severity}>
            {content}
          </article>
        )
      })}
    </div>
  )
}

async function fetchData<T>(url: string): Promise<{ data: T | null; error?: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { data: null, error: `API returned ${res.status}` }
    const body = (await res.json()) as T | { data: T }
    if (isDataEnvelope<T>(body)) return { data: body.data }
    return { data: body }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Request failed' }
  }
}

function isDataEnvelope<T>(body: T | { data: T }): body is { data: T } {
  return typeof body === 'object' && body !== null && 'data' in body
}

function formatSeverity(severity: string): string {
  if (severity === 'good') return 'Healthy'
  if (severity === 'critical') return 'Critical'
  if (severity === 'warning') return 'Needs review'
  return 'Unavailable'
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}
