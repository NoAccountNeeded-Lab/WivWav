import type { FastifyPluginAsync } from 'fastify'
import type { QueueAdapter, QueueFactory, QueuedJobActionResult } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'

interface InternalOpsQueueJobsPluginOptions {
  queueFactory: QueueFactory
}

type JobAction = 'cancel' | 'retry' | 'make-ready'

const ACTIONS: Record<JobAction, {
  run: (q: QueueAdapter, id: string) => Promise<QueuedJobActionResult>
  note: string
}> = {
  cancel: {
    run: (q, id) => q.removeQueued(id),
    note: 'Removed the queued attempt only. A worker already running this job is not stopped.',
  },
  retry: {
    run: (q, id) => q.retryFailed(id),
    note: 'Moved back to waiting with attempts reset.',
  },
  'make-ready': {
    run: (q, id) => q.makeReady(id),
    note: 'Promoted to waiting.',
  },
}

export const internalOpsQueueJobsRoutes: FastifyPluginAsync<InternalOpsQueueJobsPluginOptions> = async (
  app,
  { queueFactory },
) => {
  const queues = new Map<string, QueueAdapter>()
  for (const name of Object.values(QUEUES)) queues.set(name, queueFactory.createQueue(name))

  for (const [action, { run, note }] of Object.entries(ACTIONS) as [JobAction, (typeof ACTIONS)[JobAction]][]) {
    // POST /internal/ops/queues/:name/jobs/:id/{cancel,retry,make-ready}
    app.post<{ Params: { name: string; id: string } }>(`/:name/jobs/:id/${action}`, async (req, reply) => {
      const q = queues.get(req.params.name)
      if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
      const result = await run(q, req.params.id)
      if (result.outcome === 'not_found') return reply.notFound(`Job "${req.params.id}" not found`)
      if (result.outcome === 'conflict') {
        return reply.code(409).send({ error: { code: 'JOB_CONFLICT', message: result.reason } })
      }
      return reply.send({ data: { id: req.params.id, action, message: note } })
    })
  }
}
