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
    label: 'Detail processing',
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
  'Stages group queues for orientation. Queue counts are current backlog, not a lifecycle: a listing does not pass through these stages in one serial line. Open a source to see its actual run tree.'

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
  /** waiting + active + delayed across the stage's reported queues (partial when `missingQueues` is non-empty); null when no queue was reported. */
  work: number | null
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
      return { definition, state: 'unavailable', work: null, failed: null, queues: figures, missingQueues }
    }
    const work = figures.reduce((sum, figure) => sum + figure.waiting + figure.active + figure.delayed, 0)
    const failed = figures.reduce((sum, figure) => sum + figure.failed, 0)
    // A partial report never reads as working/idle: the missing queues are unknown, not empty.
    const state: FlowStageState = failed > 0
      ? 'exceptions'
      : figures.some(figure => figure.paused)
        ? 'paused'
        : missingQueues.length > 0
          ? 'unavailable'
          : work > 0
            ? 'working'
            : 'idle'
    return { definition, state, work, failed, queues: figures, missingQueues }
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

export interface BacklogRow {
  queue: string
  waiting: number
  active: number
  delayed: number
  total: number
}

/** Queues with pending work, largest backlog first; `queues` null means unavailable (not empty). */
export function buildBacklogRows(queues: QueueRow[] | null): BacklogRow[] | null {
  if (queues === null) return null
  return queues
    .map(queue => ({
      queue: queue.name,
      waiting: queue.stats.waiting,
      active: queue.stats.active,
      delayed: queue.stats.delayed,
      total: queue.stats.waiting + queue.stats.active + queue.stats.delayed,
    }))
    .filter(row => row.total > 0)
    .sort((a, b) => b.total - a.total || a.queue.localeCompare(b.queue))
}

export interface RecentRunWindow {
  /** Oldest → newest, as `ScrapeRunChart` expects (it keeps the last N). */
  points: { label: string; success: boolean | null; listingsFound: number | null }[]
  /** "Latest 20 of 100 most recent runs (all sources), 08:00–09:10" style window description. */
  windowLabel: string
}

/** `/admin/runs` is newest-first; reverse so the chart's "last N" are the newest N. */
export function buildRecentRunWindow<R extends { sourceName: string | null; sourceId: string; startedAt: string; success: boolean | null; listingsFound: number | null }>(
  runs: R[] | null,
  maxBars: number,
): RecentRunWindow | null {
  if (runs === null) return null
  const newestFirst = [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  const shown = newestFirst.slice(0, maxBars).reverse()
  const first = shown[0]
  const last = shown[shown.length - 1]
  const range = first && last
    ? `, started ${new Date(first.startedAt).toISOString().slice(0, 16).replace('T', ' ')} to ${new Date(last.startedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : ''
  return {
    points: shown.map(run => ({
      label: `${run.sourceName ?? run.sourceId} ${new Date(run.startedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      success: run.success,
      listingsFound: run.listingsFound,
    })),
    windowLabel: `Latest ${shown.length} of the ${runs.length} most recent scrape runs across all sources${range}`,
  }
}
