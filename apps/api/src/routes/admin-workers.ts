import type { FastifyPluginAsync } from 'fastify'
import type { WorkerCapabilities, WorkerMachineInfo } from '@wivwav/types/worker-protocol'
import type { WorkerRegistry } from '../worker-gateway/registry.js'

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

/** Fleet totals since the API started (in-memory on the registry; survive worker reconnects, reset on restart). */
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
  /** Settled (completed + failed) jobs per minute since the API started. */
  jobsPerMinute: number | null
  /** When the API (registry) started. */
  statsSince: string
  queues: QueueSummary[]
}

export interface ConnectedWorkerSummary {
  /** Key for pause/resume (#1151); identifies one live socket, unlike the untrusted workerId. */
  connectionId: string
  /** False while paused: no new dispatches, in-flight jobs finish. */
  accepting: boolean
  workerId: string
  workerName: string
  capabilities: WorkerCapabilities
  machine?: WorkerMachineInfo
  /** `inFlight.size` — kept beside the per-job detail below for at-a-glance load. */
  inFlightCount: number
  /**
   * In-flight job detail (#1067). Correlation ids ARE exposed here (unlike the
   * original count-only shape): this is an operator-authenticated surface and
   * the queue + timing is what makes the row actionable. Socket
   * internals stay server-side.
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
  /** Settled jobs with a known duration — the divisor for this worker's average. */
  timed: number
}

const avg = (totalMs: number, timed: number): number | null => (timed > 0 ? totalMs / timed : null)

function summarize(registry: WorkerRegistry, now: Date): WorkersSummary {
  const workers = registry.list()
  const { fleet } = registry
  const running = new Map<string, number>()
  for (const w of workers) {
    for (const job of w.jobs.values()) running.set(job.queueName, (running.get(job.queueName) ?? 0) + 1)
  }
  const names = new Set([...fleet.queues.keys(), ...running.keys()])
  const queues = [...names]
    .map((queueName) => {
      const q = fleet.queues.get(queueName)
      return {
        queueName,
        running: running.get(queueName) ?? 0,
        completed: q?.completed ?? 0,
        failed: q?.failed ?? 0,
        avgDurationMs: q ? avg(q.totalDurationMs, q.timed) : null,
      }
    })
    .sort((a, b) => b.completed + b.failed + b.running - (a.completed + a.failed + a.running))
  const settled = fleet.completed + fleet.failed
  const minutes = (now.getTime() - registry.startedAt.getTime()) / 60_000
  return {
    workers: workers.length,
    busyWorkers: workers.filter((w) => w.inFlight.size > 0).length,
    inFlight: workers.reduce((n, w) => n + w.inFlight.size, 0),
    capacity: workers.reduce((n, w) => n + w.capabilities.maxConcurrentJobs, 0),
    completed: fleet.completed,
    failed: fleet.failed,
    escalated: fleet.escalated,
    successRate: settled > 0 ? fleet.completed / settled : null,
    avgDurationMs: avg(fleet.totalDurationMs, fleet.timed),
    jobsPerMinute: minutes > 0 ? settled / minutes : null,
    statsSince: registry.startedAt.toISOString(),
    queues,
  }
}

/**
 * GET /internal/ops/workers — read-only snapshot of `WorkerRegistry.list()` (#1038).
 * Mount inside an adminAuthPlugin-guarded scope at the `/internal/ops/workers` prefix.
 * Workers are only ever registered when the worker gateway is enabled; with it
 * disabled the registry is empty and this returns an empty list.
 */
export const adminWorkersRoutes: FastifyPluginAsync<AdminWorkersPluginOptions> = async (
  app,
  { registry },
) => {
  app.get('/', async (_req, reply) => {
    const data: ConnectedWorkerSummary[] = registry.list().map((worker) => ({
      connectionId: worker.connectionId,
      accepting: worker.accepting !== false,
      workerId: worker.workerId,
      workerName: worker.workerName,
      capabilities: worker.capabilities,
      ...(worker.machine ? { machine: worker.machine } : {}),
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
      timed: worker.stats.timed,
    }))
    return reply.send({ data, summary: summarize(registry, new Date()) })
  })
}
