import type { QueueRow } from '../ops/overview-helpers'
import { FLOW_STAGES } from './flow-model'

/**
 * Current queue work, split the way an operator acts on it:
 *  - waiting: queued, a worker has not started it
 *  - running: a worker is processing it now (BullMQ "active")
 *  - delayed: held back until a later time. The API does not say whether that
 *    is a schedule or a retry backoff, and it carries no job age, so delayed
 *    work is never counted as backlog or as stuck.
 * `failed` is BullMQ's retained failed-job count (not a rate or "now").
 */
export const QUEUE_LABELS: Record<string, string> = {
  'source-scrape': 'Discovery scrape',
  'detail-crawl': 'Detail crawl',
  'detail-extract': 'Detail extraction',
  geocode: 'Geocoding',
  'vin-enrich': 'VIN decoding',
  deduplicate: 'Duplicate matching',
  'dealer-enrich': 'Dealer matching',
  'listing-resolve': 'Listing resolution',
  'listing-sync': 'Search index sync',
  'listing-index-poll': 'Search index polling',
}

export const OTHER_STAGE_LABEL = 'Other queues (reference data, maintenance)'

export function queueLabel(name: string): string {
  return QUEUE_LABELS[name] ?? name
}

export interface QueueWorkRow {
  queue: string
  label: string
  stageId: string
  paused: boolean
  waiting: number
  running: number
  delayed: number
  failed: number
}

export interface StageWork {
  id: string
  label: string
  waiting: number
  running: number
  delayed: number
  failed: number
  queues: number
  /** Queues named by the stage definition that the API did not report: the figures are then a lower bound. */
  missingQueues: string[]
}

export interface QueueWorkModel {
  /** Every reported queue, most waiting-plus-running first, so exact figures are never hidden. */
  rows: QueueWorkRow[]
  /** Rows with waiting or running work: what the default chart draws. */
  busy: QueueWorkRow[]
  /** Rows holding only delayed jobs. */
  delayedOnly: QueueWorkRow[]
  stages: StageWork[]
  totals: { waiting: number; running: number; delayed: number; failed: number }
}

function stageOf(queue: string): { id: string; label: string } {
  const stage = FLOW_STAGES.find(item => item.queues.includes(queue))
  return stage ? { id: stage.id, label: stage.label } : { id: 'other', label: OTHER_STAGE_LABEL }
}

const ready = (row: { waiting: number; running: number }) => row.waiting + row.running

/** `queues` null means the queue API was unavailable: returns null, never zeros. */
export function buildQueueWork(queues: QueueRow[] | null): QueueWorkModel | null {
  if (queues === null) return null
  const rows: QueueWorkRow[] = queues
    .map(queue => ({
      queue: queue.name,
      label: queueLabel(queue.name),
      stageId: stageOf(queue.name).id,
      paused: queue.paused,
      waiting: queue.stats.waiting,
      running: queue.stats.active,
      delayed: queue.stats.delayed,
      failed: queue.stats.failed,
    }))
    .sort((a, b) => ready(b) - ready(a) || b.delayed - a.delayed || a.label.localeCompare(b.label))

  const sum = (pick: (row: QueueWorkRow) => number, list: QueueWorkRow[] = rows) => list.reduce((total, row) => total + pick(row), 0)
  const stageDefs = [...FLOW_STAGES.map(stage => ({ id: stage.id as string, label: stage.label, defined: stage.queues })), { id: 'other', label: OTHER_STAGE_LABEL, defined: [] as readonly string[] }]
  const stages = stageDefs
    .map(def => {
      const members = rows.filter(row => row.stageId === def.id)
      return {
        id: def.id,
        label: def.label,
        waiting: sum(row => row.waiting, members),
        running: sum(row => row.running, members),
        delayed: sum(row => row.delayed, members),
        failed: sum(row => row.failed, members),
        queues: members.length,
        missingQueues: def.defined.filter(name => !members.some(row => row.queue === name)),
      }
    })
    .filter(stage => stage.id !== 'other' || stage.queues > 0)

  return {
    rows,
    busy: rows.filter(row => ready(row) > 0),
    delayedOnly: rows.filter(row => ready(row) === 0 && row.delayed > 0),
    stages,
    totals: { waiting: sum(row => row.waiting), running: sum(row => row.running), delayed: sum(row => row.delayed), failed: sum(row => row.failed) },
  }
}

export function waitingRunningText(row: { waiting: number; running: number }): string {
  return `${row.waiting.toLocaleString()} waiting · ${row.running.toLocaleString()} running`
}
