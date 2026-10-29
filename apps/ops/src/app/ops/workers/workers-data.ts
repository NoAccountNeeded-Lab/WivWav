import type { WorkerMachineInfo } from '@wivwav/types/worker-protocol'

export interface InFlightJob {
  queueName: string
  correlationId: string
  dispatchedAt: string
}

export interface RecentJob {
  queueName: string
  correlationId: string
  success: boolean
  escalated?: boolean
  errorMessage?: string
  durationMs?: number
  finishedAt: string
}

export interface ConnectedWorker {
  /** Keys pause/resume; one live socket. */
  connectionId: string
  /** False while an operator has paused the worker (no new dispatches; in-flight finish). */
  accepting: boolean
  workerId: string
  workerName: string
  capabilities: { chromium: boolean; httpEnrich: boolean; maxConcurrentJobs: number }
  /** Absent for workers that have not yet adopted the optional hello metadata. */
  machine?: WorkerMachineInfo
  inFlightCount: number
  inFlightJobs: InFlightJob[]
  recentJobs: RecentJob[]
  lastHeartbeatAt: string
  connectedAt: string
  completed: number
  failed: number
  escalated: number
  totalDurationMs: number
  /** Settled jobs with a known duration: the divisor for the average. */
  timed: number
}

export interface QueueSummary {
  queueName: string
  running: number
  completed: number
  failed: number
  avgDurationMs: number | null
}

export interface WorkersSummary {
  workers: number
  busyWorkers: number
  inFlight: number
  capacity: number
  completed: number
  failed: number
  escalated: number
  successRate: number | null
  avgDurationMs: number | null
  jobsPerMinute: number | null
  statsSince: string | null
  queues: QueueSummary[]
}

export interface WorkersPayload {
  workers: ConnectedWorker[]
  summary: WorkersSummary
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number'
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v)

function isMachineInfo(value: unknown): value is WorkerMachineInfo {
  return (
    isRecord(value) &&
    isStr(value.hostname) &&
    isStr(value.platform) &&
    isStr(value.osRelease) &&
    isStr(value.arch) &&
    isStr(value.cpuModel) &&
    Number.isInteger(value.cpuCount) &&
    isNum(value.cpuCount) &&
    value.cpuCount > 0 &&
    Number.isInteger(value.totalMemBytes) &&
    isNum(value.totalMemBytes) &&
    value.totalMemBytes > 0 &&
    isStr(value.nodeVersion) &&
    isStr(value.appVersion)
  )
}

function isInFlightJob(row: unknown): row is InFlightJob {
  return isRecord(row) && isStr(row.queueName) && isStr(row.correlationId) && isStr(row.dispatchedAt)
}

function isRecentJob(row: unknown): row is RecentJob {
  return (
    isRecord(row) &&
    isStr(row.queueName) &&
    isStr(row.correlationId) &&
    typeof row.success === 'boolean' &&
    (row.escalated === undefined || typeof row.escalated === 'boolean') &&
    (row.errorMessage === undefined || isStr(row.errorMessage)) &&
    (row.durationMs === undefined || isNum(row.durationMs)) &&
    isStr(row.finishedAt)
  )
}

function isConnectedWorker(row: unknown): row is ConnectedWorker {
  if (!isRecord(row) || !isRecord(row.capabilities)) return false
  return (
    isStr(row.connectionId) &&
    typeof row.accepting === 'boolean' &&
    isStr(row.workerId) &&
    isStr(row.workerName) &&
    (row.machine === undefined || isMachineInfo(row.machine)) &&
    isNum(row.inFlightCount) &&
    Array.isArray(row.inFlightJobs) &&
    (row.inFlightJobs as unknown[]).every(isInFlightJob) &&
    Array.isArray(row.recentJobs) &&
    (row.recentJobs as unknown[]).every(isRecentJob) &&
    isStr(row.lastHeartbeatAt) &&
    isStr(row.connectedAt) &&
    isNum(row.completed) &&
    isNum(row.failed) &&
    isNum(row.escalated) &&
    isNum(row.totalDurationMs) &&
    isNum(row.timed) &&
    typeof row.capabilities.chromium === 'boolean' &&
    typeof row.capabilities.httpEnrich === 'boolean' &&
    isNum(row.capabilities.maxConcurrentJobs)
  )
}

function isQueueSummary(row: unknown): row is QueueSummary {
  return (
    isRecord(row) &&
    isStr(row.queueName) &&
    isNum(row.running) &&
    isNum(row.completed) &&
    isNum(row.failed) &&
    isNumOrNull(row.avgDurationMs)
  )
}

function isSummary(row: unknown): row is WorkersSummary {
  return (
    isRecord(row) &&
    ['workers', 'busyWorkers', 'inFlight', 'capacity', 'completed', 'failed', 'escalated'].every((k) => isNum(row[k])) &&
    isNumOrNull(row.successRate) &&
    isNumOrNull(row.avgDurationMs) &&
    isNumOrNull(row.jobsPerMinute) &&
    (row.statsSince === null || isStr(row.statsSince)) &&
    Array.isArray(row.queues) &&
    (row.queues as unknown[]).every(isQueueSummary)
  )
}

export function parseWorkers(body: unknown): WorkersPayload {
  if (
    !isRecord(body) ||
    !Array.isArray(body.data) ||
    !body.data.every(isConnectedWorker) ||
    !isSummary(body.summary)
  ) {
    throw new Error('API returned an unexpected response')
  }
  return { workers: body.data, summary: body.summary }
}

/** A worker whose own heartbeat is older than this is shown as overdue (heartbeats arrive far more often). */
export const STALE_HEARTBEAT_MS = 45_000

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function logsHref(search: string, startMs?: number): string {
  const params = new URLSearchParams({ search })
  if (startMs !== undefined) params.set('start', new Date(startMs - 60_000).toISOString())
  return `/ops/logs?${params.toString()}`
}
