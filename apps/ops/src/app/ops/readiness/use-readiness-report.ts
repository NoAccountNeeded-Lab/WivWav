'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HealthResponse } from '@wivwav/types'
import {
  buildReadinessReport,
  type ListingSearchSnapshot,
  type QueueSnapshot,
  type ReadinessReport,
  type ResourceState,
  type RunSnapshot,
  type ScheduleSnapshot,
  type SourceSnapshot,
} from './readiness-model'

const REFRESH_MS = 30_000

interface ReadinessInputsState {
  health: ResourceState<HealthResponse>
  queues: ResourceState<QueueSnapshot[]>
  sources: ResourceState<SourceSnapshot[]>
  schedules: ResourceState<ScheduleSnapshot[]>
  runs: ResourceState<RunSnapshot[]>
  listingSearch: ResourceState<ListingSearchSnapshot>
}

export interface UseReadinessReportResult {
  report: ReadinessReport | null
  updatedAt: Date | null
  isRefreshing: boolean
  refresh: () => Promise<void>
}

/**
 * Fetches the six resources `buildReadinessReport` needs and polls them on
 * the same 30s cadence `/ops/readiness` has always used — extracted from
 * `ReadinessClient` (#913) so the docked-terminal preview route's readiness
 * panel renders the exact same report from the exact same data, not a
 * re-derived copy.
 */
export function useReadinessReport(apiBaseUrl: string): UseReadinessReportResult {
  const [inputs, setInputs] = useState<ReadinessInputsState | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    const [health, queues, sources, schedules, runs, listingSearch] = await Promise.all([
      fetchResource<HealthResponse>(`${apiBaseUrl}/health`),
      fetchDataResource<QueueSnapshot[]>(`${apiBaseUrl}/admin/queues`),
      fetchDataResource<SourceSnapshot[]>(`${apiBaseUrl}/admin/sources`),
      fetchDataResource<ScheduleSnapshot[]>(`${apiBaseUrl}/admin/repeatables`),
      fetchDataResource<RunSnapshot[]>(`${apiBaseUrl}/admin/runs`),
      fetchResource<ListingSearchSnapshot>(`${apiBaseUrl}/v1/listings?perPage=1`),
    ])

    setInputs({ health, queues, sources, schedules, runs, listingSearch })
    setUpdatedAt(new Date())
    setIsRefreshing(false)
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  const report = useMemo<ReadinessReport | null>(() => {
    if (!inputs) return null
    return buildReadinessReport({ ...inputs, now: updatedAt ?? new Date() })
  }, [inputs, updatedAt])

  return { report, updatedAt, isRefreshing, refresh }
}

async function fetchDataResource<T>(url: string): Promise<ResourceState<T>> {
  const response = await fetchResource<{ data: T }>(url)
  if (response.status === 'unavailable') return response
  return { status: 'loaded', data: response.data.data }
}

async function fetchResource<T>(url: string): Promise<ResourceState<T>> {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`API returned ${response.status}`)
    return { status: 'loaded', data: await response.json() as T }
  } catch (err) {
    return {
      status: 'unavailable',
      error: err instanceof Error ? err.message : 'Request failed',
    }
  }
}
