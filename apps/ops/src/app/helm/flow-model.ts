import type { QueueRow } from '../ops/overview-helpers'

/**
 * The four conceptual stages shown on /helm. These group BullMQ queues for
 * orientation only: a listing does not move serially through them, so the
 * lineage caveat below is shown wherever the stages are drawn. Actual
 * lineage lives in the per-source run tree (`/admin/sources/:id/job-runs`).
 */
export interface FlowStageDefinition {
  id: 'discovery' | 'detail' | 'enrichment' | 'search'
  label: string
  description: string
  queues: readonly string[]
}

export const FLOW_STAGES: readonly FlowStageDefinition[] = [
  {
    id: 'discovery',
    label: 'Discovery',
    description: 'Scrapes source index pages and upserts listings.',
    queues: ['source-scrape'],
  },
  {
    id: 'detail',
    label: 'Detail crawl and extraction',
    description: 'Crawls listing detail pages and extracts WAV fields.',
    queues: ['detail-crawl', 'detail-extract'],
  },
  {
    id: 'enrichment',
    label: 'Enrichment',
    description: 'Geocoding, VIN decoding, dealer matching, dedupe and resolve. Runs across all sources.',
    queues: ['geocode', 'vin-enrich', 'deduplicate', 'dealer-enrich', 'listing-resolve'],
  },
  {
    id: 'search',
    label: 'Search',
    description: 'Rebuilds and polls the Meilisearch listing index.',
    queues: ['listing-sync', 'listing-index-poll'],
  },
]

export const FLOW_LINEAGE_CAVEAT =
  'Stages group queues for orientation. Queue counts are what is queued right now, not a lifecycle: a listing does not pass through these stages in one serial line. Open a source to see its actual run tree.'

export type FlowStageState = 'unavailable' | 'paused' | 'exceptions' | 'working' | 'idle'

export interface FlowQueueFigure {
  name: string
  paused: boolean
  waiting: number
  active: number
  delayed: number
  failed: number
}

export interface FlowStageModel {
  definition: FlowStageDefinition
  state: FlowStageState
  /** Waiting + running across the stage's reported queues (a lower bound when `missingQueues` is non-empty); null when no queue was reported. Delayed jobs are separate. */
  ready: number | null
  delayed: number | null
  failed: number | null
  queues: FlowQueueFigure[]
  /** Queue names in the definition the API did not report — shown, never counted as zero. */
  missingQueues: string[]
}

export function buildFlowStages(queues: QueueRow[] | null): FlowStageModel[] {
  return FLOW_STAGES.map(definition => {
    const reported = definition.queues
      .map(name => queues?.find(queue => queue.name === name))
      .filter((queue): queue is QueueRow => queue !== undefined)
    const figures: FlowQueueFigure[] = reported.map(queue => ({
      name: queue.name,
      paused: queue.paused,
      waiting: queue.stats.waiting,
      active: queue.stats.active,
      delayed: queue.stats.delayed,
      failed: queue.stats.failed,
    }))
    const missingQueues = definition.queues.filter(name => !figures.some(figure => figure.name === name))
    if (queues === null || figures.length === 0) {
      return { definition, state: 'unavailable', ready: null, delayed: null, failed: null, queues: figures, missingQueues }
    }
    const ready = figures.reduce((sum, figure) => sum + figure.waiting + figure.active, 0)
    const delayed = figures.reduce((sum, figure) => sum + figure.delayed, 0)
    const failed = figures.reduce((sum, figure) => sum + figure.failed, 0)
    // A partial report never reads as working/idle: the missing queues are unknown, not empty.
    const state: FlowStageState = failed > 0
      ? 'exceptions'
      : figures.some(figure => figure.paused)
        ? 'paused'
        : missingQueues.length > 0
          ? 'unavailable'
          : ready > 0
            ? 'working'
            : 'idle'
    return { definition, state, ready, delayed, failed, queues: figures, missingQueues }
  })
}

export function flowStateLabel(state: FlowStageState): string {
  switch (state) {
    case 'unavailable': return 'Unavailable'
    case 'paused': return 'Paused'
    case 'exceptions': return 'Has exceptions'
    case 'working': return 'Working'
    case 'idle': return 'Idle'
  }
}
