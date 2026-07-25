'use client'

import { useCallback, useMemo } from 'react'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { usePolledResource } from '@/lib/use-polled-resource'
import type { OverviewResources } from '../../use-overview-resources'
import {
  buildReadinessReport,
  type ListingSearchSnapshot,
  type QueueSnapshot,
  type ReadinessReport,
  type ResourceState,
  type RunSnapshot,
  type ScheduleSnapshot,
  type SourceSnapshot,
} from '../../readiness/readiness-model'

const REFRESH_MS = 30_000

export interface DashboardReadiness {
  report: ReadinessReport | null
  isRefreshing: boolean
}

interface FetchResult<T> {
  data: T | null
  error?: string
}

function toResourceState<T>(data: T | null, error: string | null): ResourceState<T> | null {
  if (data !== null) return { status: 'loaded', data }
  if (error !== null) return { status: 'unavailable', error }
  return null
}

async function fetchListingSearchSnapshot(url: string): Promise<FetchResult<ListingSearchSnapshot>> {
  try {
    const res = await fetchWithTimeout(url, { cache: 'no-store' }, 10_000)
    if (!res.ok) return { data: null, error: `API returned ${res.status}` }
    return { data: await res.json() as ListingSearchSnapshot }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { data: null, error: 'Request timed out' }
    }
    return { data: null, error: err instanceof Error ? err.message : 'Request failed' }
  }
}

/**
 * Builds the same `ReadinessReport` `/ops/readiness` renders (issue #912:
 * reuse existing Overview data, no new API surface) from the shared
 * `useOverviewResources` resources plus the one extra endpoint
 * `ReadinessClient` also fetches directly — `/v1/listings?perPage=1`, for
 * the search-index total — so this route doesn't duplicate readiness
 * scoring logic, only re-wires already-existing inputs into it.
 */
export function useDashboardReadiness(apiBaseUrl: string, resources: OverviewResources): DashboardReadiness {
  const listingSearch = usePolledResource<ListingSearchSnapshot>(
    'ops-dashboard-grid:listing-search',
    useCallback(() => fetchListingSearchSnapshot(`${apiBaseUrl}/v1/listings?perPage=1`), [apiBaseUrl]),
    REFRESH_MS,
  )

  const { health, queues, sources, runs, schedules, now } = resources

  const report = useMemo<ReadinessReport | null>(() => {
    const healthState = toResourceState(health.data, health.error)
    const queuesState = toResourceState<QueueSnapshot[]>(queues.data, queues.error)
    const sourcesState = toResourceState<SourceSnapshot[]>(sources.data, sources.error)
    const schedulesState = toResourceState<ScheduleSnapshot[]>(schedules.data, schedules.error)
    const runsState = toResourceState<RunSnapshot[]>(runs.data, runs.error)
    const listingSearchState = toResourceState(listingSearch.data, listingSearch.error)

    if (!healthState || !queuesState || !sourcesState || !schedulesState || !runsState || !listingSearchState) return null

    return buildReadinessReport({
      health: healthState,
      queues: queuesState,
      sources: sourcesState,
      schedules: schedulesState,
      runs: runsState,
      listingSearch: listingSearchState,
      now,
    })
  }, [
    health.data, health.error,
    queues.data, queues.error,
    sources.data, sources.error,
    schedules.data, schedules.error,
    runs.data, runs.error,
    listingSearch.data, listingSearch.error,
    now,
  ])

  return { report, isRefreshing: listingSearch.isRefreshing }
}
