import type { FastifyPluginAsync } from 'fastify'
import type { QueueAdapter } from '@wivwav/queue'
import { SOURCE_SCOPED_QUEUES } from '../services/admin-queue-helpers.js'

interface AdminQueuesOptions {
  queues: Map<string, QueueAdapter>
}

interface QueueJobBody {
  data?: Record<string, unknown>
}

const queueJobBodySchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        data: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    },
    { type: 'null' },
  ],
} as const


// Queue inspection and control: stats, enqueue, pause/resume, clean failed.
export const adminQueueRoutes: FastifyPluginAsync<AdminQueuesOptions> = async (app, { queues }) => {
  // GET /admin/queues — all queues with stats
  app.get('/queues', async (_req, reply) => {
    try {
      const data = await Promise.all(
        [...queues.entries()].map(async ([name, q]) => ({
          name,
          paused: await q.isPaused(),
          stats: await q.getStats(),
          policy: q.getPolicy(),
        })),
      )
      return reply.send({ data })
    } catch (err) {
      app.log.error(err, 'Queue service unavailable')
      return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Queue service is unavailable' } })
    }
  })

  // GET /admin/queues/:name — single queue stats + recent jobs
  app.get<{ Params: { name: string } }>('/queues/:name', async (req, reply) => {
    const q = queues.get(req.params.name)
    if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
    const [stats, paused, jobs] = await Promise.all([
      q.getStats(),
      q.isPaused(),
      q.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed']),
    ])
    return reply.send({ data: { name: req.params.name, paused, stats, jobs, policy: q.getPolicy() } })
  })

  // POST /admin/queues/:name/jobs — enqueue a job
  app.post<{ Params: { name: string }; Body: QueueJobBody | null }>(
    '/queues/:name/jobs',
    { schema: { body: queueJobBodySchema } },
    async (req, reply) => {
      const q = queues.get(req.params.name)
      if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
      const data = req.body?.data ?? {}
      if (
        SOURCE_SCOPED_QUEUES.has(req.params.name)
        && (typeof data['sourceId'] !== 'string' || data['sourceId'].trim().length === 0)
      ) {
        return reply.code(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: `Queue "${req.params.name}" requires a non-empty data.sourceId`,
          },
        })
      }
      const id = await q.add({ ...data, traceId: req.id })
      return reply.code(201).send({ data: { id } })
    },
  )

  // POST /admin/queues/:name/pause
  app.post<{ Params: { name: string } }>('/queues/:name/pause', async (req, reply) => {
    const q = queues.get(req.params.name)
    if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
    await q.pause()
    return reply.send({ data: { paused: true } })
  })

  // POST /admin/queues/:name/resume
  app.post<{ Params: { name: string } }>('/queues/:name/resume', async (req, reply) => {
    const q = queues.get(req.params.name)
    if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
    await q.resume()
    return reply.send({ data: { paused: false } })
  })

  // DELETE /admin/queues/:name/failed — clean all failed jobs from a queue
  app.delete<{ Params: { name: string } }>('/queues/:name/failed', async (req, reply) => {
    const q = queues.get(req.params.name)
    if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
    const removed = await q.cleanFailed()
    return reply.send({ data: { removed } })
  })
}
