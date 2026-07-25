'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { buildOpsOverview, type OverviewModel } from '../../overview-helpers'
import { problemCountsBySeverity, unacknowledgedProblems, type ProblemPresentationContext } from '../../problem-presentation'
import { useOverviewResources } from '../../use-overview-resources'
import { useProblemAggregate } from '../../use-problem-aggregate'
import { useDashboardReadiness } from './use-dashboard-readiness'
import { GridPanel, type PanelSize } from './GridPanel'
import {
  ActiveProblemsPanelContent,
  QueueDepthPanelContent,
  ReadinessChecklistPanelContent,
  RecentRunsPanelContent,
  RecurringJobsPanelContent,
  ServiceHealthPanelContent,
} from './panel-content'
import styles from './dashboard-grid.module.css'

interface DashboardGridClientProps {
  apiBaseUrl: string
}

type PanelId = 'health' | 'problems' | 'queues' | 'runs' | 'schedules' | 'readiness'

interface PanelState {
  size: PanelSize
  collapsed: boolean
  closed: boolean
}

/** Session-only (component state, reset on reload) per the issue's scope —
 *  this is a comparison route, not the real Overview, so no persistence. */
const PANEL_DEFAULTS: Record<PanelId, PanelState> = {
  health:    { size: 'medium', collapsed: false, closed: false },
  problems:  { size: 'medium', collapsed: false, closed: false },
  queues:    { size: 'small',  collapsed: false, closed: false },
  runs:      { size: 'medium', collapsed: false, closed: false },
  schedules: { size: 'small',  collapsed: false, closed: false },
  readiness: { size: 'large',  collapsed: false, closed: false },
}

const PANEL_TITLES: Record<PanelId, string> = {
  health: 'Service health',
  problems: 'Active problems',
  queues: 'Queue depth',
  runs: 'Recent source runs',
  schedules: 'Recurring jobs',
  readiness: 'Site readiness',
}

const PANEL_ORDER: PanelId[] = ['health', 'problems', 'queues', 'runs', 'schedules', 'readiness']

/**
 * "Dashboard grid" Overview comparison candidate (#912): renders the exact
 * data `OpsOverviewClient` and `/ops/problems`, `/ops/queues`, `/ops/runs`,
 * `/ops/schedules`, `/ops/readiness` already fetch, as a grid of
 * independent widget panels instead of a link list — for side-by-side
 * review against the current Overview and the docked-terminal candidate
 * (#913). No new API surface: `useOverviewResources` + `useProblemAggregate`
 * are the same shared hooks `OpsOverviewClient` uses, and
 * `useDashboardReadiness` re-wires those same resources plus the one extra
 * endpoint `ReadinessClient` fetches into the existing `buildReadinessReport`.
 */
export function DashboardGridClient({ apiBaseUrl }: DashboardGridClientProps) {
  const overviewResources = useOverviewResources(apiBaseUrl)
  const { health, queues, sources, runs, schedules, listingRefresh, now } = overviewResources
  const problemAggregate = useProblemAggregate(apiBaseUrl, overviewResources)
  const readiness = useDashboardReadiness(apiBaseUrl, overviewResources)

  const overview = useMemo<OverviewModel>(() => buildOpsOverview({
    health: health.data,
    queues: queues.data,
    sources: sources.data,
    runs: runs.data,
    schedules: schedules.data,
    listingRefresh: listingRefresh.data,
    problemCounts: problemAggregate.data ? problemCountsBySeverity(unacknowledgedProblems(problemAggregate.data.problems)) : null,
    errors: {
      ...(health.error         ? { health:         health.error }         : {}),
      ...(queues.error         ? { queues:         queues.error }         : {}),
      ...(sources.error        ? { sources:        sources.error }        : {}),
      ...(runs.error           ? { runs:           runs.error }           : {}),
      ...(schedules.error      ? { schedules:      schedules.error }      : {}),
      ...(listingRefresh.error ? { listingRefresh: listingRefresh.error } : {}),
    },
    pending: {
      health: health.isLoading,
      queues: queues.isLoading,
      sources: sources.isLoading,
      runs: runs.isLoading,
      schedules: schedules.isLoading,
      listingRefresh: listingRefresh.isLoading,
    },
    now,
  }), [
    health.data, health.error, health.isLoading,
    queues.data, queues.error, queues.isLoading,
    sources.data, sources.error, sources.isLoading,
    runs.data, runs.error, runs.isLoading,
    schedules.data, schedules.error, schedules.isLoading,
    listingRefresh.data, listingRefresh.error, listingRefresh.isLoading,
    problemAggregate.data, now,
  ])

  const [panels, setPanels] = useState<Record<PanelId, PanelState>>(PANEL_DEFAULTS)
  // A panel's Close button is removed from the DOM along with the rest of
  // the panel, which would otherwise drop keyboard/screen-reader focus to
  // <body> with no indication of what happened. Closing instead hands focus
  // to the page heading (a stable landmark that always remains).
  const headingRef = useRef<HTMLHeadingElement>(null)

  function setSize(id: PanelId, size: PanelSize) {
    setPanels(prev => ({ ...prev, [id]: { ...prev[id], size } }))
  }
  function toggleCollapse(id: PanelId) {
    setPanels(prev => ({ ...prev, [id]: { ...prev[id], collapsed: !prev[id].collapsed } }))
  }
  function close(id: PanelId) {
    setPanels(prev => ({ ...prev, [id]: { ...prev[id], closed: true } }))
    headingRef.current?.focus()
  }

  const problemContext: ProblemPresentationContext = useMemo(() => ({ health: health.data, sources: sources.data }), [health.data, sources.data])

  const panelContent: Record<PanelId, ReactNode> = {
    health: <ServiceHealthPanelContent cards={overview.healthCards} />,
    problems: <ActiveProblemsPanelContent problems={problemAggregate.data?.problems ?? null} context={problemContext} />,
    queues: <QueueDepthPanelContent queues={queues.data} />,
    runs: <RecentRunsPanelContent runs={runs.data} now={now} />,
    schedules: <RecurringJobsPanelContent schedules={schedules.data} />,
    readiness: <ReadinessChecklistPanelContent report={readiness.report} />,
  }

  const visiblePanels = PANEL_ORDER.filter(id => !panels[id].closed)

  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.header}>
        <p className={styles.kicker}>Dev-only comparison route (#912)</p>
        <h1 className={styles.heading} tabIndex={-1} ref={headingRef}>Dashboard grid</h1>
        <p className={styles.intro}>
          The same data <code>/ops</code> renders, as independent widget panels — resize, collapse, or close each
          one to compare this layout against the current Overview.
        </p>
      </header>

      {visiblePanels.length === 0 ? (
        <p className={styles.empty}>All panels closed. Reload to restore the default layout.</p>
      ) : (
        <div className={styles.grid}>
          {visiblePanels.map(id => (
            <GridPanel
              key={id}
              title={PANEL_TITLES[id]}
              size={panels[id].size}
              collapsed={panels[id].collapsed}
              onSizeChange={size => setSize(id, size)}
              onToggleCollapse={() => toggleCollapse(id)}
              onClose={() => close(id)}
            >
              {panelContent[id]}
            </GridPanel>
          ))}
        </div>
      )}
    </main>
  )
}
