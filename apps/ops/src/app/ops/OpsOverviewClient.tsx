'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileText,
  Globe,
  HelpCircle,
  Layers,
  List,
  MapPin,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Terminal,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { HealthResponse } from '@wivwav/types'
import styles from './page.module.css'
import {
  buildOpsOverview,
  type OverviewCard,
  type OverviewModel,
  type OverviewSeverity,
  type QueueRow,
  type RunRow,
  type ScheduleEntry,
  type SourceRow,
} from './overview-helpers'
import { CopyButton } from '@/components/CopyButton'
import { OpsRunbooks } from './OpsRunbooks'
import { OPS_RUNBOOK_IDS } from './runbooks'
import { ScrapeRunChart, type ScrapeRunPoint } from '@/components/SparklineChart'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { getOpsOverviewLinks } from './ops-nav'

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
/** Maximum number of polling-cycle samples to retain in the ring buffers */
const RING_BUFFER_SIZE = 20

const OPS_LINK_ICONS: Record<string, LucideIcon> = {
  '/ops/refresh-listings': RefreshCw,
  '/ops/queues': Layers,
  '/ops/sources': Globe,
  '/ops/runs': Activity,
  '/ops/schedules': Calendar,
  '/ops/logs': Terminal,
  '/ops/ai': Bot,
  '/ops/config': Settings2,
  '/status': ShieldCheck,
}

const OPS_LINKS = getOpsOverviewLinks()

const CARD_ICONS: Record<string, LucideIcon> = {
  api:                        Zap,
  postgres:                   Database,
  valkey:                     Server,
  meilisearch:                Search,
  queues:                     Layers,
  scraper:                    Bot,
  'active-listings':          List,
  'last-successful-scrape':   Clock,
  'sources-needing-remap':    AlertTriangle,
  'geocode-readiness':        MapPin,
  'search-readiness':         Search,
  'missing-coordinates':      MapPin,
  'search-sync-age':          RefreshCw,
  'listing-freshness-window': Clock,
}

/* Column span for each card in the 4-column bento grid */
const CARD_COL_SPAN: Record<string, number> = {
  api:                        1,
  postgres:                   1,
  valkey:                     1,
  meilisearch:                1,
  queues:                     2,
  scraper:                    2,
  'active-listings':          2,
  'last-successful-scrape':   1,
  'sources-needing-remap':    1,
  'geocode-readiness':        2,
  'search-readiness':         2,
  'missing-coordinates':      2,
  'search-sync-age':          1,
  'listing-freshness-window': 1,
}

export function OpsOverviewClient({ apiBaseUrl }: OpsOverviewClientProps) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Ring buffer — accumulate samples across 30-second polling cycles
  // We track the run IDs we've already added to the scrape run chart to avoid duplicates
  const seenRunIdsRef = useRef<Set<string>>(new Set())
  const [scrapeRunPoints, setScrapeRunPoints] = useState<ScrapeRunPoint[]>([])

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    const [health, queues, sources, runs, schedules] = await Promise.all([
      fetchData<HealthResponse>(`${apiBaseUrl}/health`),
      fetchData<QueueRow[]>(`${apiBaseUrl}/admin/queues`),
      fetchData<SourceRow[]>(`${apiBaseUrl}/admin/sources`),
      fetchData<RunRow[]>(`${apiBaseUrl}/admin/runs`),
      fetchData<ScheduleEntry[]>(`${apiBaseUrl}/admin/repeatables`),
    ])
    const now = new Date()

    // Update scrape run list — add only runs not yet seen, preserving order
    if (runs.data) {
      const newRuns = runs.data.filter(r => !seenRunIdsRef.current.has(r.id))
      if (newRuns.length > 0) {
        newRuns.forEach(r => seenRunIdsRef.current.add(r.id))
        setScrapeRunPoints(prev => {
          const added: ScrapeRunPoint[] = newRuns.map(r => ({
            label: r.sourceName ?? r.sourceId,
            success: r.success,
            listingsFound: r.listingsFound,
          }))
          // Keep oldest first; trim to RING_BUFFER_SIZE
          const combined = [...prev, ...added]
          return combined.length > RING_BUFFER_SIZE ? combined.slice(-RING_BUFFER_SIZE) : combined
        })
      }
    }

    setData({
      health: health.data,
      queues: queues.data,
      sources: sources.data,
      runs: runs.data,
      schedules: schedules.data,
      errors: {
        ...(health.error    ? { health:    health.error    } : {}),
        ...(queues.error    ? { queues:    queues.error    } : {}),
        ...(sources.error   ? { sources:   sources.error   } : {}),
        ...(runs.error      ? { runs:      runs.error      } : {}),
        ...(schedules.error ? { schedules: schedules.error } : {}),
      },
    })
    setUpdatedAt(now)
    setIsRefreshing(false)
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const overview = useMemo<OverviewModel | null>(() => {
    if (!data) return null
    return buildOpsOverview({ ...data, now: updatedAt ?? new Date() })
  }, [data, updatedAt])

  return (
    <main id="main-content" className={styles.main}>

      {/* ── Compact hero ─────────────────────────────────────────────────── */}
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>Operator overview</p>
          <h1 className={styles.heading}>WivWav Health</h1>
        </div>
        {overview && (
          <div className={styles.heroStatus} data-severity={overview.overall.severity}>
            <SeverityIcon severity={overview.overall.severity} size={16} />
            <span className={styles.heroStatusLabel}>{overview.overall.label}</span>
          </div>
        )}
        <div className={styles.heroRefresh}>
          <span className={styles.updatedAt} aria-live="polite">
            {updatedAt ? formatTime(updatedAt) : '—'}
          </span>
          <button
            className={styles.refreshButton}
            type="button"
            onClick={() => void refresh()}
            disabled={isRefreshing}
          >
            <RefreshCw size={13} className={isRefreshing ? styles.spinning : undefined} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {!overview ? (
        <div className={styles.loadingPanel} aria-live="polite">Loading…</div>
      ) : (
        <div className={styles.bentoGrid}>

          {/* ── Attention panel (4 cols) ───────────────────────────────── */}
          <aside className={`${styles.bentoCard} ${styles.span4} ${styles.attentionCard}`} aria-label="Attention needed">
            <div className={styles.cardHeader}>
              <AlertCircle size={14} />
              <span>Attention Needed</span>
              <Link href="/ops/logs" className={styles.cardHeaderLink}>Logs →</Link>
            </div>
            <div className={styles.attentionList}>
              {overview.attention.map(item => (
                <div key={item.id} className={styles.attentionItemWrap}>
                  <Link href={item.href} className={styles.attentionItem} data-severity={item.severity}>
                    <SeverityIcon severity={item.severity} size={14} />
                    <div>
                      <strong className={styles.attentionTitle}>{item.title}</strong>
                      <ExpandableDetail text={item.detail} />
                    </div>
                  </Link>
                  <CopyButton
                    text={`${item.title}: ${item.detail}`}
                    label={`Copy ${item.title}`}
                    className={styles.attentionCopyBtn}
                  />
                </div>
              ))}
            </div>
          </aside>

          {/* ── Section: Service & Queue Health ───────────────────────── */}
          <div className={`${styles.bentoLabel} ${styles.span4}`}>
            <Cpu size={13} />
            <span>Service &amp; Queue Health</span>
            <Link href="/status" className={styles.labelLink}>Raw status →</Link>
          </div>
          {overview.healthCards.map(card => (
            <MetricCard key={card.id} card={card} span={CARD_COL_SPAN[card.id] ?? 1} />
          ))}

          {/* ── Per-queue breakdown ─────────────────────────────────── */}
          {data?.queues && data.queues.length > 0 && (
            <div className={`${styles.bentoCard} ${styles.chartCard} ${styles.span4}`}>
              <div className={styles.chartCardHeader}>
                <Layers size={12} />
                <span>Queues</span>
                <span className={styles.chartHint}>waiting · active · delayed · failed</span>
              </div>
              <div className={styles.chartCardBody}>
                <div className={styles.queueBreakdown} role="table" aria-label="Per-queue job counts">
                  {data.queues.map(queue => (
                    <div key={queue.name} className={styles.queueBreakdownRow} role="row">
                      <span className={styles.queueBreakdownName} role="cell">
                        <Link href="/ops/queues">{queue.name}</Link>
                        {queue.paused && <span className={styles.queueBreakdownPaused}>Paused</span>}
                      </span>
                      <span className={styles.queueBreakdownStat} role="cell">{queue.stats.waiting}w</span>
                      <span className={styles.queueBreakdownStat} role="cell">{queue.stats.active}a</span>
                      <span className={styles.queueBreakdownStat} role="cell">{queue.stats.delayed}d</span>
                      <span
                        className={styles.queueBreakdownStat}
                        data-alert={queue.stats.failed > 0}
                        role="cell"
                      >
                        {queue.stats.failed}f
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Section: Listing Freshness ────────────────────────────── */}
          <div className={`${styles.bentoLabel} ${styles.span4}`}>
            <Activity size={13} />
            <span>Listing Freshness</span>
            <Link href="/ops/runs" className={styles.labelLink}>Scraper runs →</Link>
          </div>
          {overview.freshnessCards.map(card => (
            <MetricCard key={card.id} card={card} span={CARD_COL_SPAN[card.id] ?? 1} />
          ))}

          {/* ── Scrape success chart ────────────────────────────────── */}
          <div className={`${styles.bentoCard} ${styles.chartCard} ${styles.span4}`}>
            <div className={styles.chartCardHeader}>
              <Activity size={12} />
              <span>Scrape Run History</span>
              <span className={styles.chartHint}>Last {scrapeRunPoints.length > 0 ? scrapeRunPoints.length : '…'} runs · success/failure per run · height = listings found</span>
            </div>
            <div className={styles.chartCardBody}>
              <ScrapeRunChart
                runs={scrapeRunPoints}
                maxBars={RING_BUFFER_SIZE}
                ariaLabel="Bar chart of recent scrape run results; green bars are successful runs, red bars are failed runs, height indicates listings found"
              />
            </div>
          </div>

          {/* ── Section: Telemetry Gaps ───────────────────────────────── */}
          <div className={`${styles.bentoLabel} ${styles.span4}`}>
            <FileText size={13} />
            <span>Telemetry Gaps</span>
          </div>
          {overview.telemetry.map(card => (
            <MetricCard key={card.id} card={card} span={CARD_COL_SPAN[card.id] ?? 1} />
          ))}

        </div>
      )}

      {/* ── Nav grid ──────────────────────────────────────────────────────── */}
      <nav className={styles.linkGrid} aria-label="Operations areas">
        {OPS_LINKS.map(link => {
          const Icon = OPS_LINK_ICONS[link.href] ?? Activity

          return (
            <Link key={link.href} href={link.href} className={styles.areaLink}>
              <span className={styles.areaIcon}><Icon size={18} /></span>
              <strong className={styles.areaLabel}>{link.shell?.overviewQuickLink?.label ?? link.title}</strong>
              <span className={styles.areaDetail}>{link.desc}</span>
            </Link>
          )
        })}
      </nav>

      <OpsRunbooks ids={OPS_RUNBOOK_IDS} />
    </main>
  )
}

function MetricCard({ card, span }: { card: OverviewCard; span: number }) {
  const Icon = CARD_ICONS[card.id] ?? Activity
  const spanClass = span === 2 ? styles.span2 : span === 3 ? styles.span3 : undefined

  const content = (
    <>
      <div className={styles.metricTop}>
        <span className={styles.metricIcon} data-severity={card.severity}>
          <Icon size={15} />
        </span>
        <span className={styles.metricLabel}>{card.label}</span>
        <span
          className={styles.statusDot}
          data-severity={card.severity}
          title={`${severityLabel(card.severity)}: ${card.detail}`}
          aria-label={`${card.label} status: ${card.severity}`}
        />
      </div>
      <strong className={styles.metricValue}>{card.value}</strong>
      <span className={styles.metricDetail}>{card.detail}</span>
    </>
  )

  const cardCls = [styles.bentoCard, styles.metricCard].filter(Boolean).join(' ')
  const wrapCls = [styles.metricCardWrap, spanClass].filter(Boolean).join(' ')
  const copyText = `${card.label}: ${card.value}\n${card.detail}`

  return (
    <div className={wrapCls}>
      {card.href ? (
        <Link href={card.href} className={cardCls} data-severity={card.severity}>{content}</Link>
      ) : (
        <article className={cardCls} data-severity={card.severity}>{content}</article>
      )}
      <CopyButton text={copyText} label={`Copy ${card.label}`} className={styles.cardCopyBtn} />
    </div>
  )
}

function SeverityIcon({ severity, size }: { severity: OverviewSeverity; size: number }) {
  if (severity === 'good')     return <CheckCircle2  size={size} className={styles.iconGood} />
  if (severity === 'critical') return <AlertCircle   size={size} className={styles.iconCritical} />
  if (severity === 'warning')  return <AlertTriangle size={size} className={styles.iconWarning} />
  return <HelpCircle size={size} className={styles.iconUnknown} />
}

function ExpandableDetail({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const MAX = 110

  if (text.length <= MAX) return <span className={styles.attentionDetail}>{text}</span>

  return (
    <span className={styles.attentionDetail}>
      {expanded ? text : text.slice(0, MAX) + '…'}
      {' '}
      <button
        type="button"
        className={styles.expandBtn}
        onClick={e => { e.preventDefault(); e.stopPropagation(); setExpanded(v => !v) }}
      >
        {expanded ? 'show less' : 'show more'}
      </button>
    </span>
  )
}

function severityLabel(severity: OverviewSeverity): string {
  if (severity === 'good')     return 'Healthy'
  if (severity === 'warning')  return 'Warning'
  if (severity === 'critical') return 'Critical'
  return 'Unknown'
}

async function fetchData<T>(url: string): Promise<{ data: T | null; error?: string }> {
  try {
    const res = await fetchWithTimeout(url, { cache: 'no-store' }, 10_000)
    if (!res.ok) return { data: null, error: `API returned ${res.status}` }
    const body = (await res.json()) as T | { data: T }
    if (isDataEnvelope<T>(body)) return { data: body.data }
    return { data: body }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { data: null, error: 'Request timed out' }
    }
    return { data: null, error: err instanceof Error ? err.message : 'Request failed' }
  }
}

function isDataEnvelope<T>(body: T | { data: T }): body is { data: T } {
  return typeof body === 'object' && body !== null && 'data' in body
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date)
}
