import type { FastifyPluginAsync } from 'fastify'
import type { WorkerCapabilities } from '@wivwav/types/worker-protocol'
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
  finishedAt: string
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
        finishedAt: job.finishedAt.toISOString(),
      })),
      lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
    }))
    return reply.send({ data })
  })
}
