import type { FastifyPluginAsync } from 'fastify'
import type { WorkerCapabilities } from '@wivwav/types/worker-protocol'
import type { RegisteredWorker, WorkerRegistry } from '../worker-gateway/registry.js'

export interface AdminWorkersPluginOptions {
  registry: WorkerRegistry
}

export interface InFlightJobSummary {
  queueName: string
  correlationId: string
  dispatchedAt: string
}

export interface RecentJobSummary {
  queueName: string
  correlationId: string
  success: boolean
  escalated?: boolean
  errorMessage?: string
  durationMs?: number
  finishedAt: string
}

export interface QueueSummary {
  queueName: string
  running: number
  completed: number
  failed: number
  /** null when nothing has settled for this queue. */
  avgDurationMs: number | null
}

/** Fleet totals since the API started (in-memory; reset on restart). */
export interface WorkersSummary {
  workers: number
  busyWorkers: number
  inFlight: number
  capacity: number
  completed: number
  failed: number
  escalated: number
  /** completed / (completed + failed); null when nothing has settled. */
  successRate: number | null
  avgDurationMs: number | null
  /** Settled (completed + failed) jobs per minute since the earliest connectedAt; null with no workers. */
  jobsPerMinute: number | null
  /** Earliest `connectedAt` across workers; null with no workers. */
  statsSince: string | null
  queues: QueueSummary[]
}

export interface ConnectedWorkerSummary {
  workerId: string
  workerName: string
  capabilities: WorkerCapabilities
  /** `inFlight.size` — kept beside the per-job detail below for at-a-glance load. */
  inFlightCount: number
  /**
   * In-flight job detail (#1067). Correlation ids ARE exposed here (unlike the
   * original count-only shape): this is an operator-authenticated surface and
   * the queue + timing is what makes the row actionable. `connectionId` and
   * socket internals stay server-side.
   */
  inFlightJobs: InFlightJobSummary[]
  /** Most recent settled outcomes, newest first (bounded per worker). */
  recentJobs: RecentJobSummary[]
  /**
   * When the coordinator last received the worker's own `heartbeat` message.
   * Not a liveness guarantee: connection eviction is driven by WS ping/pong.
   */
  lastHeartbeatAt: string
  connectedAt: string
  completed: number
  failed: number
  escalated: number
  totalDurationMs: number
}

const avg = (totalMs: number, n: number): number | null => (n > 0 ? totalMs / n : null)

function summarize(workers: RegisteredWorker[], now: Date): WorkersSummary {
  const queues = new Map<string, QueueSummary & { totalDurationMs: number }>()
  const row = (queueName: string) => {
    let q = queues.get(queueName)
    if (!q) {
      q = { queueName, running: 0, completed: 0, failed: 0, avgDurationMs: null, totalDurationMs: 0 }
      queues.set(queueName, q)
    }
    return q
  }
  let completed = 0
  let failed = 0
  let escalated = 0
  let totalDurationMs = 0
  for (const w of workers) {
    completed += w.stats.completed
    failed += w.stats.failed
    escalated += w.stats.escalated
    totalDurationMs += w.stats.totalDurationMs
    for (const [name, qs] of w.stats.queues) {
      const q = row(name)
      q.completed += qs.completed
      q.failed += qs.failed
      q.totalDurationMs += qs.totalDurationMs
    }
    for (const job of w.jobs.values()) row(job.queueName).running++
  }
  const settled = completed + failed
  const since = workers.reduce<Date | undefined>(
    (min, w) => (!min || w.stats.connectedAt < min ? w.stats.connectedAt : min),
    undefined,
  )
  const minutes = since ? (now.getTime() - since.getTime()) / 60_000 : 0
  return {
    workers: workers.length,
    busyWorkers: workers.filter((w) => w.inFlight.size > 0).length,
    inFlight: workers.reduce((n, w) => n + w.inFlight.size, 0),
    capacity: workers.reduce((n, w) => n + w.capabilities.maxConcurrentJobs, 0),
    completed,
    failed,
    escalated,
    successRate: settled > 0 ? completed / settled : null,
    avgDurationMs: avg(totalDurationMs, settled),
    jobsPerMinute: since && minutes > 0 ? settled / minutes : null,
    statsSince: since?.toISOString() ?? null,
    queues: [...queues.values()]
      .map(({ totalDurationMs: t, ...q }) => ({ ...q, avgDurationMs: avg(t, q.completed + q.failed) }))
      .sort((a, b) => b.completed + b.failed + b.running - (a.completed + a.failed + a.running)),
  }
}

/**
 * GET /admin/workers — read-only snapshot of `WorkerRegistry.list()` (#1038).
 * Mount inside an adminAuthPlugin-guarded scope at the `/admin/workers` prefix.
 * Workers are only ever registered when the worker gateway is enabled; with it
 * disabled the registry is empty and this returns an empty list.
 */
export const adminWorkersRoutes: FastifyPluginAsync<AdminWorkersPluginOptions> = async (
  app,
  { registry },
) => {
  app.get('/', async (_req, reply) => {
    const data: ConnectedWorkerSummary[] = registry.list().map((worker) => ({
      workerId: worker.workerId,
      workerName: worker.workerName,
      capabilities: worker.capabilities,
      inFlightCount: worker.inFlight.size,
      inFlightJobs: [...worker.jobs.entries()].map(([correlationId, job]) => ({
        queueName: job.queueName,
        correlationId,
        dispatchedAt: job.dispatchedAt.toISOString(),
      })),
      recentJobs: worker.recentJobs.map((job) => ({
        queueName: job.queueName,
        correlationId: job.correlationId,
        success: job.success,
        ...(job.escalated !== undefined ? { escalated: job.escalated } : {}),
        ...(job.errorMessage !== undefined ? { errorMessage: job.errorMessage } : {}),
        ...(job.durationMs !== undefined ? { durationMs: job.durationMs } : {}),
        finishedAt: job.finishedAt.toISOString(),
      })),
      lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
      connectedAt: worker.stats.connectedAt.toISOString(),
      completed: worker.stats.completed,
      failed: worker.stats.failed,
      escalated: worker.stats.escalated,
      totalDurationMs: worker.stats.totalDurationMs,
    }))
    return reply.send({ data, summary: summarize(registry.list(), new Date()) })
  })
}
