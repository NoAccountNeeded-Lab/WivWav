'use client'

import { useCallback } from 'react'
import { fetchJson } from '@/lib/fetch-json'
import { usePolledResource, type PolledResourceState } from '@/lib/use-polled-resource'
import type { PipelineStage } from '../ops/sources/[id]/source-pipeline-helpers'
import type { JobRunNode } from '../ops/sources/[id]/source-job-run-helpers'
import { HELM_POLL_OPTIONS, HELM_REFRESH_MS } from './use-helm-data'

export interface SourcePipelineData {
  source: { id: string; name: string }
  generatedAt: string
  stages: PipelineStage[]
}

export interface SourceRunTreeData {
  source: { id: string; name: string }
  generatedAt: string
  runs: JobRunNode[]
}

export interface HelmLogEntry {
  ts: string
  level: string | null
  service: string | null
  message: string | null
  requestId: string | null
  queue: string | null
  jobId: string | null
  sourceId: string | null
  stack: string | null
  extra: Record<string, unknown>
}

export interface SourceLogsData {
  sourceId: string
  entries: HelmLogEntry[]
}

export interface SourceEvidence {
  pipeline: PolledResourceState<SourcePipelineData>
  runTree: PolledResourceState<SourceRunTreeData>
  logs: PolledResourceState<SourceLogsData>
}

/**
 * Same-workspace evidence for one source: its pipeline stages, the run tree
 * (actual lineage) and recent log lines that mention the source. Mount it
 * under `key={sourceId}` so a different source never shows the previous
 * source's data while loading.
 */
export function useSourceEvidence(apiBaseUrl: string, sourceId: string): SourceEvidence {
  const encoded = encodeURIComponent(sourceId)
  const pipeline = usePolledResource<SourcePipelineData>(
    `helm:pipeline:${sourceId}`,
    useCallback(() => fetchJson<SourcePipelineData>(`${apiBaseUrl}/admin/sources/${encoded}/pipeline`), [apiBaseUrl, encoded]),
    HELM_REFRESH_MS,
    HELM_POLL_OPTIONS,
  )
  const runTree = usePolledResource<SourceRunTreeData>(
    `helm:run-tree:${sourceId}`,
    useCallback(() => fetchJson<SourceRunTreeData>(`${apiBaseUrl}/admin/sources/${encoded}/job-runs`), [apiBaseUrl, encoded]),
    HELM_REFRESH_MS,
    HELM_POLL_OPTIONS,
  )
  const logs = usePolledResource<SourceLogsData>(
    `helm:logs:${sourceId}`,
    useCallback(async () => {
      const result = await fetchJson<{ entries: HelmLogEntry[] }>(`${apiBaseUrl}/admin/logs?search=${encoded}&limit=100`)
      if (result.data === null) return { data: null, ...(result.error ? { error: result.error } : {}) }
      // Loki matches the id as a substring anywhere in a line; keep lines that name this source.
      const entries = result.data.entries.filter(entry => entry.sourceId === sourceId || (entry.message ?? '').includes(sourceId))
      return { data: { sourceId, entries } }
    }, [apiBaseUrl, encoded, sourceId]),
    HELM_REFRESH_MS,
    HELM_POLL_OPTIONS,
  )
  return { pipeline, runTree, logs }
}
