export interface PipelineStage {
  stage: string
  queue: string
  pendingCount: number
  lastCompletedAt: string | null
  failedCount: number
  failedScopedToSource: boolean
  stalled: boolean
  /** Id of the most recently failed job for this stage, if known — powers the "Explain this error" action. */
  latestFailedJobId: string | null
}

export type StageStatus = 'ok' | 'failed' | 'stalled'

/**
 * Failing (active failed jobs) takes priority over stalled (pending work with
 * no recent completion) so an operator sees the more actionable signal first
 * — a stage can be both, but "failed" is what needs attention immediately.
 */
export function stageStatus(stage: PipelineStage): StageStatus {
  if (stage.failedCount > 0) return 'failed'
  if (stage.stalled) return 'stalled'
  return 'ok'
}

export function stageStatusLabel(stage: PipelineStage): string {
  const status = stageStatus(stage)
  if (status === 'failed') return 'Failing'
  if (status === 'stalled') return 'Stalled'
  return stage.pendingCount > 0 ? 'In progress' : 'Idle'
}
