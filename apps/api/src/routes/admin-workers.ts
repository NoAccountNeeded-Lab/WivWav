import type { FastifyPluginAsync } from 'fastify'
import type { WorkerCapabilities } from '@wivwav/types/worker-protocol'
import type { WorkerRegistry } from '../worker-gateway/registry.js'

export interface AdminWorkersPluginOptions {
  registry: WorkerRegistry
}

export interface ConnectedWorkerSummary {
  workerId: string
  workerName: string
  capabilities: WorkerCapabilities
  /** `inFlight.size` — the raw correlation-id Set is never exposed. */
  inFlightCount: number
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
      lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
    }))
    return reply.send({ data })
  })
}
