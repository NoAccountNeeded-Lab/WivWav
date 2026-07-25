'use client'

import { useCallback, useMemo } from 'react'
import type { HealthResponse } from '@wivwav/types'
import { fetchJson } from '@/lib/fetch-json'
import { usePolledResource, type PolledResourceState } from '@/lib/use-polled-resource'
import type { QueueRow, RunRow, ScheduleEntry, SourceRow } from './overview-helpers'
import type { ListingRefreshStatus } from './refresh-listings/listing-refresh-workflow'

const REFRESH_MS = 30_000

export interface OverviewResources {
  health: PolledResourceState<HealthResponse>
  queues: PolledResourceState<QueueRow[]>
  sources: PolledResourceState<SourceRow[]>
  runs: PolledResourceState<RunRow[]>
  schedules: PolledResourceState<ScheduleEntry[]>
  /**
   * The listing-refresh status aggregate — currently consumed here only for
   * `listings.missingLocations` (issue #927), which feeds the
   * `missing-coordinates` telemetry tile. Shares the endpoint
   * `RefreshListingsClient` already polls, fetched independently since the
   * two pages mount separately.
   */
  listingRefresh: PolledResourceState<ListingRefreshStatus>
  /** Latest timestamp any resource settled at, or the current time if none has yet. */
  now: Date
  updatedAt: Date | null
  isRefreshing: boolean
  refreshAll: () => void
}

/**
 * Fetches/polls the five domain resources (health, queues, sources, runs,
 * schedules) the shared problem-aggregate computation needs (issue #892).
 * Shared by `OpsOverviewClient` (which also renders per-resource cards from
 * this same data) and `/ops/problems`' `ProblemsClient` (which only needs it
 * to feed `useProblemAggregate`) so the fetch/poll wiring for those five
 * resources isn't duplicated between the two pages.
 */
export function useOverviewResources(apiBaseUrl: string): OverviewResources {
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
  const listingRefresh = usePolledResource<ListingRefreshStatus>(
    'ops-overview:listing-refresh',
    useCallback(() => fetchJson<ListingRefreshStatus>(`${apiBaseUrl}/admin/listing-refresh/status`), [apiBaseUrl]),
    REFRESH_MS,
  )

  const latestUpdatedAtMs = Math.max(
    health.updatedAt?.getTime() ?? 0,
    queues.updatedAt?.getTime() ?? 0,
    sources.updatedAt?.getTime() ?? 0,
    runs.updatedAt?.getTime() ?? 0,
    schedules.updatedAt?.getTime() ?? 0,
    listingRefresh.updatedAt?.getTime() ?? 0,
  )
  const updatedAt = latestUpdatedAtMs > 0 ? new Date(latestUpdatedAtMs) : null
  // `now` only advances when a resource actually settles (tracked via the
  // primitive `latestUpdatedAtMs`), not on every render.
  const now = useMemo(() => (latestUpdatedAtMs > 0 ? new Date(latestUpdatedAtMs) : new Date()), [latestUpdatedAtMs])

  const isRefreshing = health.isRefreshing || queues.isRefreshing || sources.isRefreshing || runs.isRefreshing || schedules.isRefreshing || listingRefresh.isRefreshing

  const refreshAll = useCallback(() => {
    void health.retry()
    void queues.retry()
    void sources.retry()
    void runs.retry()
    void schedules.retry()
    void listingRefresh.retry()
  }, [health, queues, sources, runs, schedules, listingRefresh])

  return { health, queues, sources, runs, schedules, listingRefresh, now, updatedAt, isRefreshing, refreshAll }
}
