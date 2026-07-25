import type { OpsStatusVariant } from '@/components/OpsStatusChip'

export type JobRunStatus = 'running' | 'succeeded' | 'failed'

/** One node of the `GET /admin/sources/:id/job-runs` run tree (#933 lineage backbone). */
export interface JobRunNode {
  id: string
  jobType: string
  sourceId: string | null
  parentRunId: string | null
  status: JobRunStatus
  startedAt: string
  finishedAt: string | null
  succeededCount: number | null
  failedCount: number | null
  errorMessage: string | null
  children: JobRunNode[]
}

export function jobRunStatusVariant(status: JobRunStatus): OpsStatusVariant {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

export function jobRunStatusLabel(status: JobRunStatus): string {
  if (status === 'succeeded') return 'Succeeded'
  if (status === 'failed') return 'Failed'
  return 'Running'
}

/** `null` counts render as an em dash — most job types don't populate stats yet (#937). */
export function formatRunCount(value: number | null): string {
  return value == null ? '—' : value.toLocaleString()
}
