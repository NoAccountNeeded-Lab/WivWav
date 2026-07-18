'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
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
import type { AttentionResourceInput, AttentionSnapshot, AttentionSnapshotRequest, HealthResponse } from '@wivwav/types'
import styles from './page.module.css'
import {
  buildOpsOverview,
  type OverviewCard,
  type OverviewModel,
  type OverviewResourceKey,
  type OverviewSeverity,
  type QueueRow,
  type RunRow,
  type ScheduleEntry,
  type SourceRow,
} from './overview-helpers'
import { CopyButton } from '@/components/CopyButton'
import { SkeletonChartBox } from '@/components/Skeleton'
import { OpsRunbooks } from './OpsRunbooks'
import { OPS_RUNBOOK_IDS } from './runbooks'
import { ACTION_ICONS } from './action-icons'
import type { ScrapeRunPoint } from '@wivwav/charts'
import { fetchJson } from '@/lib/fetch-json'
import { usePolledResource, type PolledResourceState } from '@/lib/use-polled-resource'
import { getOpsOverviewLinks } from './ops-nav'

/** Subset of resource state the attention-panel retry buttons need — avoids
 *  variance issues from mixing differently-typed resources in one map. */
type RetryableResource = Pick<PolledResourceState<unknown>, 'retry' | 'isRefreshing'>

// The scrape-run bar chart is not needed for first paint and pulls in its own
// rendering logic — load it on demand so it never blocks the rest of the
// overview from streaming in (E5: lazy-load heavy client components).
const ScrapeRunChart = dynamic(
  () => import('@wivwav/charts').then(mod => mod.ScrapeRunChart),
  { ssr: false, loading: () => <SkeletonChartBox aspectRatio="4/1" /> },
)

interface OpsOverviewClientProps {
  apiBaseUrl: string
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

/** Attention item ids that mean "this resource's endpoint failed" — see overview-helpers.ts */
const UNAVAILABLE_ATTENTION_ID: Record<string, OverviewResourceKey> = {
  'health-unavailable':      'health',
  'queues-unavailable':      'queues',
  'sources-unavailable':     'sources',
  'runs-unavailable':        'runs',
  'schedules-unavailable':   'schedules',
  'attention-unavailable':   'attention',
}

/** Reports a polled resource's already-known state in the shape the shared
 *  domain computation expects (issue #774) — `unavailable` mirrors the same
 *  "settled with no data and no explicit error" rule overview-helpers.ts
 *  otherwise applies per-resource, so the two never disagree about whether a
 *  resource has genuinely failed vs. simply not loaded yet. */
function toAttentionResourceInput<T>(resource: PolledResourceState<T>): AttentionResourceInput<T> {
  return {
    data: resource.data,
    unavailable: Boolean(resource.error) || (resource.data === null && !resource.isLoading),
  }
}

export function OpsOverviewClient({ apiBaseUrl }: OpsOverviewClientProps) {
  // Each endpoint is fetched, polled, cached, and retried independently so a
  // slow or failing endpoint never blocks the other sections from rendering
  // (E5: streaming overview + per-section inline retry).
  const health = usePolledResource<HealthResponse>(
    'ops-overview:health',
    useCallback(() => fetchJson<HealthResponse>(`${apiBaseUrl}/health`), [apiBaseUrl]),
    REFRESH_MS,
  )
  const queues = usePolledResource<QueueRow[]>(
    'ops-overview:queues',
    useCallback(() => fetchJson<QueueRow[]>(`${apiBaseUrl}/admin/queues`), [apiBaseUrl]),
    REFRESH_MS,
  )
  const sources = usePolledResource<SourceRow[]>(
    'ops-overview:sources',
    useCallback(() => fetchJson<SourceRow[]>(`${apiBaseUrl}/admin/sources`), [apiBaseUrl]),
    REFRESH_MS,
  )
  const runs = usePolledResource<RunRow[]>(
    'ops-overview:runs',
    useCallback(() => fetchJson<RunRow[]>(`${apiBaseUrl}/admin/runs`), [apiBaseUrl]),
    REFRESH_MS,
  )
  const schedules = usePolledResource<ScheduleEntry[]>(
    'ops-overview:schedules',
    useCallback(() => fetchJson<ScheduleEntry[]>(`${apiBaseUrl}/admin/repeatables`), [apiBaseUrl]),
    REFRESH_MS,
  )

  // Ring buffer — accumulate samples across 30-second polling cycles
  // We track the run IDs we've already added to the scrape run chart to avoid duplicates
  const seenRunIdsRef = useRef<Set<string>>(new Set())
  const [scrapeRunPoints, setScrapeRunPoints] = useState<ScrapeRunPoint[]>([])

  useEffect(() => {
    if (!runs.data) return
    const newRuns = runs.data.filter(r => !seenRunIdsRef.current.has(r.id))
    if (newRuns.length === 0) return
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
  }, [runs.data])

  const latestUpdatedAtMs = Math.max(
    health.updatedAt?.getTime() ?? 0,
    queues.updatedAt?.getTime() ?? 0,
    sources.updatedAt?.getTime() ?? 0,
    runs.updatedAt?.getTime() ?? 0,
    schedules.updatedAt?.getTime() ?? 0,
  )
  const updatedAt = latestUpdatedAtMs > 0 ? new Date(latestUpdatedAtMs) : null
  // `now` only advances when a resource actually settles (tracked via the
  // primitive `latestUpdatedAtMs`), not on every render.
  const now = useMemo(() => (latestUpdatedAtMs > 0 ? new Date(latestUpdatedAtMs) : new Date()), [latestUpdatedAtMs])

  // Runs the shared domain-level attention computation (issue #774) over the
  // resource state already fetched/polled above, rather than recomputing
  // "what is currently wrong" client-side. Posting the already-known state —
  // instead of this endpoint re-fetching it server-side — preserves each
  // resource's independent per-section loading/error/retry UX (E5) without
  // racing a second, server-side fetch of the same data.
  const attention = usePolledResource<AttentionSnapshot>(
    'ops-overview:attention',
    useCallback(() => {
      const body: AttentionSnapshotRequest = {
        now: now.toISOString(),
        health: toAttentionResourceInput(health),
        queues: toAttentionResourceInput(queues),
        sources: toAttentionResourceInput(sources),
        runs: toAttentionResourceInput(runs),
        schedules: toAttentionResourceInput(schedules),
      }
      return fetchJson<AttentionSnapshot>(`${apiBaseUrl}/admin/attention-snapshot`, 10_000, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }, [apiBaseUrl, now, health, queues, sources, runs, schedules]),
    REFRESH_MS,
  )

  // Not memoized: usePolledResource returns a new object every render
  // regardless, so a useMemo here would never actually skip recomputation.
  const resources: Record<OverviewResourceKey, RetryableResource> = { health, queues, sources, runs, schedules, attention }

  const overview = useMemo<OverviewModel>(() => buildOpsOverview({
    health: health.data,
    queues: queues.data,
    sources: sources.data,
    runs: runs.data,
    schedules: schedules.data,
    attention: attention.data,
    errors: {
      ...(health.error     ? { health:     health.error }     : {}),
      ...(queues.error     ? { queues:     queues.error }     : {}),
      ...(sources.error    ? { sources:    sources.error }    : {}),
      ...(runs.error       ? { runs:       runs.error }       : {}),
      ...(schedules.error  ? { schedules:  schedules.error }  : {}),
      ...(attention.error  ? { attention:  attention.error }  : {}),
    },
    pending: {
      health: health.isLoading,
      queues: queues.isLoading,
      sources: sources.isLoading,
      runs: runs.isLoading,
      schedules: schedules.isLoading,
      attention: attention.isLoading,
    },
    now,
  }), [health.data, health.error, health.isLoading, queues.data, queues.error, queues.isLoading, sources.data, sources.error, sources.isLoading, runs.data, runs.error, runs.isLoading, schedules.data, schedules.error, schedules.isLoading, attention.data, attention.error, attention.isLoading, now])

  const isRefreshing = health.isRefreshing || queues.isRefreshing || sources.isRefreshing || runs.isRefreshing || schedules.isRefreshing || attention.isRefreshing

  const refreshAll = useCallback(() => {
    void health.retry()
    void queues.retry()
    void sources.retry()
    void runs.retry()
    void schedules.retry()
    void attention.retry()
  }, [health, queues, sources, runs, schedules, attention])

  return (
    <main id="main-content" className={styles.main}>

      {/* ── Compact hero ─────────────────────────────────────────────────── */}
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>Operator overview</p>
          <h1 className={styles.heading}>WivWav Health</h1>
        </div>
        <div className={styles.heroStatus} data-severity={overview.overall.severity}>
          <SeverityIcon severity={overview.overall.severity} size={16} />
          <span className={styles.heroStatusLabel}>{overview.overall.label}</span>
        </div>
        <div className={styles.heroRefresh}>
          <span className={styles.updatedAt} aria-live="polite">
            {updatedAt ? formatTime(updatedAt) : '—'}
          </span>
          <button
            className={styles.refreshButton}
            type="button"
            onClick={refreshAll}
            disabled={isRefreshing}
          >
            <ACTION_ICONS.refresh size={13} aria-hidden="true" className={isRefreshing ? styles.spinning : undefined} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className={styles.bentoGrid}>

        {/* ── Attention panel (4 cols) ───────────────────────────────── */}
        <aside className={`${styles.bentoCard} ${styles.span4} ${styles.attentionCard}`} aria-label="Attention needed">
          <div className={styles.cardHeader}>
            <AlertCircle size={14} />
            <span>Attention Needed</span>
            <Link href="/ops/logs" className={styles.cardHeaderLink}>Logs →</Link>
          </div>
          <div className={styles.attentionList}>
            {overview.attention.map(item => {
              const retryResourceKey = UNAVAILABLE_ATTENTION_ID[item.id]
              const retryResource = retryResourceKey ? resources[retryResourceKey] : undefined
              return (
                <div key={item.id} className={styles.attentionItemWrap} data-has-retry={retryResource ? 'true' : 'false'}>
                  <Link href={item.href} className={styles.attentionItem} data-severity={item.severity}>
                    <SeverityIcon severity={item.severity} size={14} />
                    <div>
                      <strong className={styles.attentionTitle}>{item.title}</strong>
                      <ExpandableDetail text={item.detail} />
                    </div>
                  </Link>
                  {retryResource && (
                    <button
                      type="button"
                      className={styles.attentionRetryBtn}
                      onClick={() => void retryResource.retry()}
                      disabled={retryResource.isRefreshing}
                    >
                      <ACTION_ICONS.refresh size={11} aria-hidden="true" className={retryResource.isRefreshing ? styles.spinning : undefined} />
                      {retryResource.isRefreshing ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                  <CopyButton
                    text={`${item.title}: ${item.detail}`}
                    label={`Copy ${item.title}`}
                    className={styles.attentionCopyBtn}
                  />
                </div>
              )
            })}
          </div>
        </aside>

        {/* ── Section: Service & Queue Health ───────────────────────── */}
        <div className={`${styles.bentoLabel} ${styles.span4}`}>
          <Cpu size={13} />
          <span>Service &amp; Queue Health</span>
          {(health.isRefreshing || queues.isRefreshing) && health.data && queues.data && (
            <span className={styles.sectionRefreshing}>Refreshing…</span>
          )}
          <Link href="/status" className={styles.labelLink}>Raw status →</Link>
        </div>
        {overview.healthCards.map(card => (
          <MetricCard key={card.id} card={card} span={CARD_COL_SPAN[card.id] ?? 1} />
        ))}

        {/* ── Per-queue breakdown ─────────────────────────────────── */}
        {queues.data && queues.data.length > 0 && (
          <div className={`${styles.bentoCard} ${styles.chartCard} ${styles.span4}`}>
            <div className={styles.chartCardHeader}>
              <Layers size={12} />
              <span>Queues</span>
              <span className={styles.chartHint}>waiting · active · delayed · failed</span>
            </div>
            <div className={styles.chartCardBody}>
              <div className={styles.queueBreakdown} role="table" aria-label="Per-queue job counts">
                {queues.data.map(queue => (
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
          {(sources.isRefreshing || runs.isRefreshing) && sources.data && runs.data && (
            <span className={styles.sectionRefreshing}>Refreshing…</span>
          )}
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
      <strong className={styles.metricValue} title={card.title}>{card.value}</strong>
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

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date)
}
