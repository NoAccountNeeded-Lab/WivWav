'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileText,
  HelpCircle,
  Layers,
  List,
  MapPin,
  RefreshCw,
  Search,
  Server,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import styles from './page.module.css'
import {
  buildOpsOverview,
  type OverviewCard,
  type OverviewModel,
  type OverviewResourceKey,
  type OverviewSeverity,
} from './overview-helpers'
import { CopyButton } from '@/components/CopyButton'
import { SkeletonChartBox } from '@/components/Skeleton'
import { OpsRunbooks } from './OpsRunbooks'
import { OPS_RUNBOOK_IDS } from './runbooks'
import { ACTION_ICONS } from './action-icons'
import type { ScrapeRunPoint } from '@wivwav/charts'
import type { PolledResourceState } from '@/lib/use-polled-resource'
import { useOverviewResources } from './use-overview-resources'
import { useProblemAggregate } from './use-problem-aggregate'
import { presentProblem, problemCountsBySeverity, sortProblems, unacknowledgedProblems } from './problem-presentation'

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

/** Maximum number of polling-cycle samples to retain in the ring buffers */
const RING_BUFFER_SIZE = 20

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
}

const TOP_PROBLEMS_PREVIEW_LIMIT = 5

export function OpsOverviewClient({ apiBaseUrl }: OpsOverviewClientProps) {
  // Each endpoint is fetched, polled, cached, and retried independently so a
  // slow or failing endpoint never blocks the other sections from rendering
  // (E5: streaming overview + per-section inline retry).
  const overviewResources = useOverviewResources(apiBaseUrl)
  const { health, queues, sources, runs, schedules, now, updatedAt } = overviewResources

  // The single server-side call the Attention panel below and `/ops/problems`
  // both render from (issue #892) — this component never recomputes "what is
  // currently wrong" itself.
  const problemAggregate = useProblemAggregate(apiBaseUrl, overviewResources)

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

  // Not memoized: usePolledResource returns a new object every render
  // regardless, so a useMemo here would never actually skip recomputation.
  const resources: Record<OverviewResourceKey, RetryableResource> = { health, queues, sources, runs, schedules }

  const overview = useMemo<OverviewModel>(() => buildOpsOverview({
    health: health.data,
    queues: queues.data,
    sources: sources.data,
    runs: runs.data,
    schedules: schedules.data,
    problemCounts: problemAggregate.data ? problemCountsBySeverity(unacknowledgedProblems(problemAggregate.data.problems)) : null,
    errors: {
      ...(health.error     ? { health:     health.error }     : {}),
      ...(queues.error     ? { queues:     queues.error }     : {}),
      ...(sources.error    ? { sources:    sources.error }    : {}),
      ...(runs.error       ? { runs:       runs.error }       : {}),
      ...(schedules.error  ? { schedules:  schedules.error }  : {}),
    },
    pending: {
      health: health.isLoading,
      queues: queues.isLoading,
      sources: sources.isLoading,
      runs: runs.isLoading,
      schedules: schedules.isLoading,
    },
    now,
  }), [health.data, health.error, health.isLoading, queues.data, queues.error, queues.isLoading, sources.data, sources.error, sources.isLoading, runs.data, runs.error, runs.isLoading, schedules.data, schedules.error, schedules.isLoading, problemAggregate.data, now])

  const topProblems = useMemo(
    () => (problemAggregate.data ? sortProblems(unacknowledgedProblems(problemAggregate.data.problems)).slice(0, TOP_PROBLEMS_PREVIEW_LIMIT) : []),
    [problemAggregate.data],
  )
  const problemPresentationContext = useMemo(() => ({ health: health.data, sources: sources.data }), [health.data, sources.data])

  const isRefreshing = overviewResources.isRefreshing || problemAggregate.isRefreshing

  const refreshAll = useCallback(() => {
    overviewResources.refreshAll()
    void problemAggregate.retry()
  }, [overviewResources, problemAggregate])

  // Calm the overview (#760): healthy services collapse into a single quiet
  // summary row so only degraded services keep an individual card.
  const degradedHealthCards = overview.healthCards.filter(card => card.severity !== 'good')
  const healthyHealthCards = overview.healthCards.filter(card => card.severity === 'good')

  // The Attention panel gets a quiet empty state instead of rendering the
  // "nothing to report" filler item through the same alarm-styled list-item
  // frame real attention items use (#760). Requires both sub-sections to be
  // clear: ops's own telemetry (the `overview.attention` fallback item) and
  // the shared problem aggregate (issue #892) reporting no active,
  // unacknowledged problems.
  const isTelemetryQuiet = overview.attention.length === 1 && overview.attention[0]?.id === 'no-attention-needed'
  const isAttentionQuiet = isTelemetryQuiet && problemAggregate.data !== null && topProblems.length === 0

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
            {isAttentionQuiet ? (
              <div className={styles.attentionEmpty}>
                <CheckCircle2 size={14} className={styles.attentionEmptyIcon} aria-hidden="true" />
                <span>Nothing needs attention</span>
              </div>
            ) : (
              <>
                {!isTelemetryQuiet && overview.attention.map(item => {
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

                {/* ── Problems preview: count + top-N, backed by the shared
                    problem-aggregate call (issue #892) — no domain
                    recompute happens in this component. ──────────────── */}
                {problemAggregate.error ? (
                  <div className={styles.attentionItemWrap} data-has-retry="true">
                    <div className={styles.attentionItem} data-severity="unknown">
                      <SeverityIcon severity="unknown" size={14} />
                      <div>
                        <strong className={styles.attentionTitle}>Problem list unavailable</strong>
                        <span className={styles.attentionDetail}>{problemAggregate.error}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.attentionRetryBtn}
                      onClick={() => void problemAggregate.retry()}
                      disabled={problemAggregate.isRefreshing}
                    >
                      <ACTION_ICONS.refresh size={11} aria-hidden="true" className={problemAggregate.isRefreshing ? styles.spinning : undefined} />
                      {problemAggregate.isRefreshing ? 'Retrying…' : 'Retry'}
                    </button>
                  </div>
                ) : topProblems.length > 0 ? (
                  <>
                    {topProblems.map(problem => {
                      const presentation = presentProblem(problem, problemPresentationContext)
                      return (
                        <div key={problem.fingerprint} className={styles.attentionItemWrap}>
                          <Link
                            href={presentation.href}
                            className={styles.attentionItem}
                            data-severity={problem.severity}
                            {...(presentation.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                          >
                            <SeverityIcon severity={problem.severity} size={14} />
                            <div>
                              <strong className={styles.attentionTitle}>{presentation.title}</strong>
                              <ExpandableDetail text={presentation.detail} />
                            </div>
                          </Link>
                          <CopyButton
                            text={`${presentation.title}: ${presentation.detail}`}
                            label={`Copy ${presentation.title}`}
                            className={styles.attentionCopyBtn}
                          />
                        </div>
                      )
                    })}
                    <Link href="/ops/problems" className={styles.attentionViewAllLink}>
                      View all problems →
                    </Link>
                  </>
                ) : null}
              </>
            )}
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
        {degradedHealthCards.map(card => (
          <MetricCard key={card.id} card={card} span={CARD_COL_SPAN[card.id] ?? 1} />
        ))}
        {healthyHealthCards.length > 0 && (
          <Link href="/status" className={`${styles.healthySummaryRow} ${styles.span4}`}>
            <CheckCircle2 size={14} className={styles.healthySummaryIcon} aria-hidden="true" />
            <span className={styles.healthySummaryLabel}>
              {degradedHealthCards.length === 0
                ? 'All services healthy'
                : `${healthyHealthCards.length} other service${healthyHealthCards.length === 1 ? '' : 's'} healthy`}
            </span>
            <span className={styles.healthySummaryTimestamp} aria-live="polite">
              {updatedAt ? formatTime(updatedAt) : '—'}
            </span>
          </Link>
        )}

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

      <OpsRunbooks ids={OPS_RUNBOOK_IDS} />
    </main>
  )
}

function MetricCard({ card, span }: { card: OverviewCard; span: number }) {
  const Icon = CARD_ICONS[card.id] ?? Activity
  const spanClass = span === 2 ? styles.span2 : span === 3 ? styles.span3 : undefined

  // Reserve color for exceptions (#760): the status dot is the single
  // severity-colored signal on a card — the icon stays neutral and the card
  // frame carries no severity tint, so a healthy card renders with zero
  // colored elements and a degraded card renders with exactly one.
  const content = (
    <>
      <div className={styles.metricTop}>
        <span className={styles.metricIcon}>
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
        <Link href={card.href} className={cardCls}>{content}</Link>
      ) : (
        <article className={cardCls}>{content}</article>
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
