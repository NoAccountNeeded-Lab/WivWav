'use client'

import { useCallback, useMemo } from 'react'
import type { HelmSummary } from '@wivwav/types'
import { fetchJson } from '@/lib/fetch-json'
import { usePolledResource, type PolledResourceOptions, type PolledResourceState } from '@/lib/use-polled-resource'
import { useOverviewResources, type OverviewResources } from '../ops/use-overview-resources'
import { useProblemAggregate } from '../ops/use-problem-aggregate'
import type { ProblemAggregateResponse } from '@wivwav/types'
import { resourceFreshness, type Freshness, type FreshnessInput } from './helm-freshness'
import { computeHelmStatus, type HelmResourceKey, type HelmStatus } from './helm-status'
import { useNow } from './use-now'

export const HELM_REFRESH_MS = 15_000

/** Every Helm poll runs only while the tab is visible and never overlaps itself. */
export const HELM_POLL_OPTIONS: Required<PolledResourceOptions> = { visibleOnly: true, preventOverlap: true }

export interface HelmData {
  resources: OverviewResources
  problems: PolledResourceState<ProblemAggregateResponse>
  summary: PolledResourceState<HelmSummary>
  freshness: Record<HelmResourceKey, Freshness>
  status: HelmStatus
  nowMs: number
  updatedAt: Date | null
  isRefreshing: boolean
  /** Refetches every resource now; each one still honours its in-flight guard. */
  refreshAll: () => void
}

export function useHelmData(apiBaseUrl: string): HelmData {
  const nowMs = useNow(5_000)
  const resources = useOverviewResources(apiBaseUrl, { refreshMs: HELM_REFRESH_MS, ...HELM_POLL_OPTIONS })
  const problems = useProblemAggregate(apiBaseUrl, resources, { refreshMs: HELM_REFRESH_MS, ...HELM_POLL_OPTIONS })
  const summary = usePolledResource<HelmSummary>(
    'helm:summary',
    useCallback(() => fetchJson<HelmSummary>(`${apiBaseUrl}/internal/ops/helm-summary`), [apiBaseUrl]),
    HELM_REFRESH_MS,
    HELM_POLL_OPTIONS,
  )

  const freshness = useMemo<Record<HelmResourceKey, Freshness>>(() => {
    const of = (resource: FreshnessInput) => resourceFreshness(resource, nowMs, HELM_REFRESH_MS)
    return {
      health: of(resources.health),
      queues: of(resources.queues),
      sources: of(resources.sources),
      runs: of(resources.runs),
      problems: of(problems),
      summary: of(summary),
    }
  }, [resources.health, resources.queues, resources.sources, resources.runs, problems, summary, nowMs])

  const status = useMemo(
    () => computeHelmStatus({
      freshness,
      problems: problems.data?.problems ?? null,
      availability: problems.data?.availability ?? null,
      summary: summary.data,
    }),
    [freshness, problems.data, summary.data],
  )

  const latest = Math.max(
    resources.updatedAt?.getTime() ?? 0,
    problems.updatedAt?.getTime() ?? 0,
    summary.updatedAt?.getTime() ?? 0,
  )
  const refreshAll = useCallback(() => {
    resources.refreshAll()
    void problems.retry()
    void summary.retry()
  }, [resources, problems, summary])

  return {
    resources,
    problems,
    summary,
    freshness,
    status,
    nowMs,
    updatedAt: latest > 0 ? new Date(latest) : null,
    isRefreshing: resources.isRefreshing || problems.isRefreshing || summary.isRefreshing,
    refreshAll,
  }
}
