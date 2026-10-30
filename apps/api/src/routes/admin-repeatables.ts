import type { FastifyPluginAsync } from 'fastify'
import type { QueueAdapter } from '@wivwav/queue'
import type { JobRunReaper } from '../lib/job-run-reaper.js'
import { QUEUES } from '@wivwav/queue'
import { appendScheduleIntent, type PrismaClient } from '@wivwav/db'
import type { SourceRepository } from '../repositories/index.js'
import { buildRepeatableStatuses, getCanonicalDefs } from '../services/repeatable-schedules.js'

interface AdminRepeatablesOptions {
  db: PrismaClient
  sources: SourceRepository
  queues: Map<string, QueueAdapter>
  jobRunReaper?: JobRunReaper
}

// Repeatable schedules: canonical definitions merged with live BullMQ state and operator intent.
export const adminRepeatableRoutes: FastifyPluginAsync<AdminRepeatablesOptions> = async (
  app,
  { db, sources, queues, jobRunReaper },
) => {
  // GET /internal/ops/repeatables — merged canonical + live BullMQ state
  app.get('/repeatables', async (_req, reply) => {
    const data = await buildRepeatableStatuses(db, sources, queues)
    return reply.send({ data, jobRuns: jobRunReaper?.getStats() ?? { reapedCount: 0, runningTooLongCount: 0 } })
  })

  // DELETE /internal/ops/repeatables/:queue — disable (remove from BullMQ) by key
  app.delete<{ Params: { queue: string }; Body: { key: string } }>(
    '/repeatables/:queue',
    async (req, reply) => {
      const q = queues.get(req.params.queue)
      if (!q) return reply.notFound(`Queue "${req.params.queue}" not found`)
      const defs = await getCanonicalDefs(sources)
      const def = defs.find((candidate) => candidate.queue === req.params.queue && candidate.jobId === req.body.key)
      if (def) {
        await appendScheduleIntent(db, def.id, { enabled: false })
      }
      await q.removeRepeatableByKey(req.body.key)
      return reply.send({ data: { removed: true } })
    },
  )

  // POST /internal/ops/repeatables/:queue — enable (add) a repeatable
  app.post<{
    Params: { queue: string }
    Body: { name: string; data: Record<string, unknown>; pattern: string; tz?: string; jobId?: string }
  }>('/repeatables/:queue', async (req, reply) => {
    const q = queues.get(req.params.queue)
    if (!q) return reply.notFound(`Queue "${req.params.queue}" not found`)
    const { name, data, pattern, tz, jobId } = req.body
    const defs = await getCanonicalDefs(sources)
    const def = defs.find((candidate) => candidate.queue === req.params.queue && candidate.jobId === jobId)
    if (def) {
      await appendScheduleIntent(db, def.id, { enabled: true, pattern, tz: tz ?? def.tz })
      if (req.params.queue === QUEUES.SOURCE_SCRAPE && typeof data['sourceId'] === 'string') {
        await sources.updateCronExpression(data['sourceId'], pattern)
      }
    }
    await q.addRepeatable(name, data, pattern, tz, jobId)
    return reply.code(201).send({ data: { added: true } })
  })

  // PUT /internal/ops/repeatables/:queue — update pattern (remove old key, add with new pattern)
  app.put<{
    Params: { queue: string }
    Body: { key: string; name: string; data: Record<string, unknown>; pattern: string; tz?: string; jobId?: string }
  }>('/repeatables/:queue', async (req, reply) => {
    const q = queues.get(req.params.queue)
    if (!q) return reply.notFound(`Queue "${req.params.queue}" not found`)
    const { key, name, data, pattern, tz, jobId } = req.body
    const defs = await getCanonicalDefs(sources)
    const def = defs.find((candidate) => candidate.queue === req.params.queue && candidate.jobId === jobId)
    if (def) {
      await appendScheduleIntent(db, def.id, { enabled: true, pattern, tz: tz ?? def.tz })
      if (req.params.queue === QUEUES.SOURCE_SCRAPE && typeof data['sourceId'] === 'string') {
        await sources.updateCronExpression(data['sourceId'], pattern)
      }
    }
    await q.removeRepeatableByKey(key)
    await q.addRepeatable(name, data, pattern, tz, jobId)
    return reply.send({ data: { updated: true } })
  })
}
