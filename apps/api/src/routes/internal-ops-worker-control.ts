import type { FastifyPluginAsync } from 'fastify'
import type { WorkerRegistry } from '../worker-gateway/registry.js'

interface WorkerControlOptions {
  registry: WorkerRegistry
}

/**
 * POST /internal/ops/workers/:connectionId/{pause,resume} (#1151). Mount in the
 * adminAuthPlugin-guarded /internal/ops scope. Pause only stops new dispatches;
 * in-flight jobs finish. A stale connectionId (worker gone or reconnected) is 404.
 */
export const internalOpsWorkerControlRoutes: FastifyPluginAsync<WorkerControlOptions> = async (
  app,
  { registry },
) => {
  for (const [action, accepting] of [['pause', false], ['resume', true]] as const) {
    app.post<{ Params: { connectionId: string } }>(`/:connectionId/${action}`, async (req, reply) => {
      const { connectionId } = req.params
      if (!registry.setAccepting(connectionId, accepting)) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Worker connection not found' } })
      }
      return reply.send({ data: { connectionId, accepting } })
    })
  }
}
