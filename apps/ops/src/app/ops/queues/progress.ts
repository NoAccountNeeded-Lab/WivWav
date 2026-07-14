export interface QueueSnapshotStats {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

export interface QueueSnapshotProgressModel {
  value: number
  max: number
  pending: number
  settled: number
  caption: string
  statusText: string
}

export type JobProgressModel =
  | {
    kind: 'determinate'
    value: number
    max: number
    label: string
    caption: string
  }
  | {
    kind: 'indeterminate'
    statusText: string
  }
  | {
    kind: 'none'
  }

interface CountLikeProgress {
  stage?: unknown
  current?: unknown
  total?: unknown
  message?: unknown
  success?: unknown
  failed?: unknown
}

export function buildQueueSnapshotProgress(stats: QueueSnapshotStats): QueueSnapshotProgressModel | null {
  const visible = stats.waiting + stats.active + stats.delayed + stats.completed + stats.failed
  if (visible <= 0) return null

  const settled = stats.completed + stats.failed
  const pending = stats.waiting + stats.active + stats.delayed

  return {
    value: settled,
    max: visible,
    pending,
    settled,
    caption: `${settled.toLocaleString()} of ${visible.toLocaleString()} visible jobs settled`,
    statusText: pending > 0
      ? `${pending.toLocaleString()} jobs are still waiting, active, or delayed.`
      : 'All visible jobs are settled.',
  }
}

export function buildJobProgressModel(job: { id: string; status: string; progress: unknown }): JobProgressModel {
  const countLike = asCountLikeProgress(job.progress)
  if (countLike && typeof countLike.current === 'number' && typeof countLike.total === 'number' && countLike.total > 0) {
    const stage = typeof countLike.stage === 'string' && countLike.stage.trim().length > 0
      ? countLike.stage.trim()
      : 'progress'
    const message = typeof countLike.message === 'string' && countLike.message.trim().length > 0
      ? ` · ${countLike.message.trim()}`
      : ''
    // Surfaced separately from `current`/`total` so a batch that "settled"
    // (every item accounted for) but partially failed is still visibly
    // distinguishable from a fully successful run (#637).
    const outcome = typeof countLike.success === 'number' && typeof countLike.failed === 'number'
      ? ` (${formatNumber(countLike.success)} succeeded, ${formatNumber(countLike.failed)} failed)`
      : ''

    return {
      kind: 'determinate',
      value: countLike.current,
      max: countLike.total,
      label: `Job #${job.id} ${stage} progress`,
      caption: `${formatNumber(countLike.current)} of ${formatNumber(countLike.total)} ${stage}${message}${outcome}`,
    }
  }

  if (job.status === 'active' || job.status === 'waiting' || job.status === 'delayed') {
    return {
      kind: 'indeterminate',
      statusText: `${capitalize(job.status)} job has not reported measurable progress yet.`,
    }
  }

  return { kind: 'none' }
}

function asCountLikeProgress(value: unknown): CountLikeProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as CountLikeProgress
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)
}
