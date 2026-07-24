'use client'

import { useCallback } from 'react'
import type { ProblemAggregateResponse } from '@wivwav/types'
import { fetchJson } from '@/lib/fetch-json'
import { usePolledResource, type PolledResourceState } from '@/lib/use-polled-resource'
import { toAttentionResourceInput } from './overview-helpers'
import type { OverviewResources } from './use-overview-resources'

const REFRESH_MS = 30_000

/**
 * Posts the already-fetched domain resource state (`resources`, from
 * `useOverviewResources`) to `POST /internal/ops/problem-aggregate` (issue
 * #892) and polls it on the same cadence as the resources feeding it.
 *
 * This is the single call the ops overview's Attention panel
 * (`OpsOverviewClient`) and `/ops/problems` (`ProblemsClient`) both render
 * from — neither may recompute "what is currently wrong" itself. Same
 * "caller reports already-fetched resource state" pattern as the
 * attention-snapshot call it replaces (E5: independent per-section
 * streaming/retry) — this route additionally fetches Grafana/Sentry state
 * itself server-side, so the caller only ever needs to report the five
 * domain resources.
 */
export function useProblemAggregate(apiBaseUrl: string, resources: OverviewResources): PolledResourceState<ProblemAggregateResponse> {
  const { health, queues, sources, runs, schedules, now } = resources

  return usePolledResource<ProblemAggregateResponse>(
    'ops:problem-aggregate',
    useCallback(() => {
      const body = {
        now: now.toISOString(),
        health: toAttentionResourceInput(health),
        queues: toAttentionResourceInput(queues),
        sources: toAttentionResourceInput(sources),
        runs: toAttentionResourceInput(runs),
        schedules: toAttentionResourceInput(schedules),
      }
      return fetchJson<ProblemAggregateResponse>(`${apiBaseUrl}/internal/ops/problem-aggregate`, 10_000, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }, [apiBaseUrl, now, health, queues, sources, runs, schedules]),
    REFRESH_MS,
  )
}
