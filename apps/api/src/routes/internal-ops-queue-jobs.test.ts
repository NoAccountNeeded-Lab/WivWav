import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it } from 'vitest'
import { MockQueueFactory, QUEUES } from '@wivwav/queue'
import type { MockQueueAdapter } from '@wivwav/queue'
import { opsAuthPlugin } from '../plugins/ops-auth.js'
import { internalOpsQueueJobsRoutes } from './internal-ops-queue-jobs.js'

const SECRET = 'a'.repeat(32)
const auth = { authorization: `Bearer ${SECRET}` }
const QUEUE = QUEUES.DETAIL_CRAWL

async function buildApp() {
  const factory = new MockQueueFactory()
  const app = Fastify()
  await app.register(sensible)
  await app.register(
    async (scope) => {
      await opsAuthPlugin(scope, { opsApiSecret: SECRET, nodeEnv: 'test' })
      await scope.register(internalOpsQueueJobsRoutes, { queueFactory: factory })
    },
    { prefix: '/internal/ops/queues' },
  )
  await app.ready()
  return { app, queue: factory.createQueue(QUEUE) as MockQueueAdapter }
}

const url = (id: string, action: string, name: string = QUEUE) => `/internal/ops/queues/${name}/jobs/${id}/${action}`

describe('POST /internal/ops/queues/:name/jobs/:id/{cancel,retry,make-ready}', () => {
  it('rejects a missing or wrong bearer', async () => {
    const { app } = await buildApp()
    for (const action of ['cancel', 'retry', 'make-ready']) {
      expect((await app.inject({ method: 'POST', url: url('1', action) })).statusCode).toBe(401)
      const wrong = await app.inject({ method: 'POST', url: url('1', action), headers: { authorization: 'Bearer nope' } })
      expect(wrong.statusCode).toBe(401)
    }
    await app.close()
  })

  it('cancels a waiting job and a delayed job', async () => {
    const { app, queue } = await buildApp()
    const waiting = await queue.add({})
    const res = await app.inject({ method: 'POST', url: url(waiting, 'cancel'), headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.message).toContain('not stopped')
    await queue.add({})
    queue.markDelayed()
    const delayed = queue.getEnqueued().at(-1)!.id
    expect((await app.inject({ method: 'POST', url: url(delayed, 'cancel'), headers: auth })).statusCode).toBe(200)
    expect(queue.getEnqueued()).toHaveLength(0)
    await app.close()
  })

  it('returns 409 for an active job and leaves it untouched', async () => {
    const { app, queue } = await buildApp()
    const id = await queue.add({})
    queue.markActive()
    const res = await app.inject({ method: 'POST', url: url(id, 'cancel'), headers: auth })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: 'JOB_CONFLICT' } })
    expect(queue.getEnqueued().map((j) => j.status)).toEqual(['active'])
    await app.close()
  })

  it('retries a failed job and makes a delayed job ready', async () => {
    const { app, queue } = await buildApp()
    const failed = await queue.add({})
    queue.markFailed('boom', 3)
    expect((await app.inject({ method: 'POST', url: url(failed, 'retry'), headers: auth })).statusCode).toBe(200)
    expect(queue.getEnqueued()[0]).toMatchObject({ status: 'waiting', attemptsMade: 0 })
    const delayed = await queue.add({})
    queue.markDelayed()
    expect((await app.inject({ method: 'POST', url: url(delayed, 'make-ready'), headers: auth })).statusCode).toBe(200)
    expect(queue.getEnqueued()[1]?.status).toBe('waiting')
    await app.close()
  })

  it('returns 409 for the wrong state and 404 for a missing job or queue', async () => {
    const { app, queue } = await buildApp()
    const id = await queue.add({})
    expect((await app.inject({ method: 'POST', url: url(id, 'retry'), headers: auth })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: url(id, 'make-ready'), headers: auth })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: url('999', 'cancel'), headers: auth })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: url(id, 'cancel', 'nope'), headers: auth })).statusCode).toBe(404)
    await app.close()
  })
})
