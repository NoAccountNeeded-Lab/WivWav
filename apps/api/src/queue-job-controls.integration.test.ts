import { afterAll, describe, expect, it } from 'vitest'
import { BullMQQueueFactory } from '@wivwav/queue'
import type { QueueAdapter, WorkerAdapter } from '@wivwav/queue'

// Redis-backed coverage for per-job ops controls (#1152). Requires a reachable
// Redis/Valkey (QUEUE_REDIS_URL / VALKEY_URL); run via `test:integration`.
const factory = new BullMQQueueFactory()
const workers: WorkerAdapter[] = []
const suffix = `it-${Date.now()}`
let n = 0

function freshQueue(): QueueAdapter {
  return factory.createQueue(`job-controls-${suffix}-${++n}`)
}

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('condition not reached')
}

const stateOf = async (q: QueueAdapter, id: string) =>
  (await q.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed'])).find((j) => j.id === id)?.status

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()))
  await factory.close()
})

describe('queued job controls against real BullMQ/Redis (integration)', () => {
  it('cancels waiting and delayed jobs', async () => {
    const q = freshQueue()
    const waiting = await q.add({})
    const delayed = await q.add({}, { delay: 60_000 })
    expect(await q.removeQueued(waiting)).toEqual({ outcome: 'ok' })
    expect(await q.removeQueued(delayed)).toEqual({ outcome: 'ok' })
    expect(await q.getJobs(['waiting', 'delayed'])).toEqual([])
  })

  it('cancels a waiting job on a paused queue', async () => {
    const q = freshQueue()
    await q.pause()
    const id = await q.add({})
    expect(await q.removeQueued(id)).toEqual({ outcome: 'ok' })
    expect(await q.getJobs(['waiting'])).toEqual([])
  })

  it('makes a delayed job ready', async () => {
    const q = freshQueue()
    const id = await q.add({}, { delay: 60_000 })
    expect(await q.makeReady(id)).toEqual({ outcome: 'ok' })
    expect(await stateOf(q, id)).toBe('waiting')
    expect((await q.makeReady(id)).outcome).toBe('conflict')
  })

  it('returns not_found for a missing job', async () => {
    const q = freshQueue()
    expect(await q.removeQueued('nope')).toEqual({ outcome: 'not_found' })
    expect(await q.retryFailed('nope')).toEqual({ outcome: 'not_found' })
    expect(await q.makeReady('nope')).toEqual({ outcome: 'not_found' })
  })

  it('conflicts on an active job and leaves it untouched', async () => {
    const q = freshQueue()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let started = false
    workers.push(factory.createWorker(q.name, async () => { started = true; await gate }))
    const id = await q.add({})
    await until(async () => started)
    expect((await q.removeQueued(id)).outcome).toBe('conflict')
    expect((await q.retryFailed(id)).outcome).toBe('conflict')
    expect(await stateOf(q, id)).toBe('active')
    release()
    await until(async () => (await stateOf(q, id)) === 'completed')
  })

  it('conflicts when the job becomes active between the state check and removal', async () => {
    const q = freshQueue()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let started = false
    workers.push(factory.createWorker(q.name, async () => { started = true; await gate }))
    const id = await q.add({})
    await until(async () => started)
    // Make the pre-check stale: it reports waiting while a worker holds the lock.
    const job = await (q as unknown as { getBullMQQueue(): { getJob(id: string): Promise<object | undefined> } }).getBullMQQueue().getJob(id)
    const proto = Object.getPrototypeOf(job) as { getState: () => Promise<string> }
    const original = proto.getState
    proto.getState = async () => 'waiting'
    try {
      expect((await q.removeQueued(id)).outcome).toBe('conflict')
    } finally {
      proto.getState = original
    }
    expect(await stateOf(q, id)).toBe('active')
    release()
  })

  it('retries a failed job back to waiting with attempts reset', async () => {
    const q = freshQueue()
    let fail = true
    const worker = factory.createWorker(q.name, async () => { if (fail) throw new Error('boom') })
    workers.push(worker)
    const id = await q.add({})
    await until(async () => (await stateOf(q, id)) === 'failed')
    await worker.close()
    fail = false
    expect(await q.retryFailed(id)).toEqual({ outcome: 'ok' })
    const [job] = await q.getJobs(['waiting'])
    expect(job).toMatchObject({ id, attemptsMade: 0 })
    expect((await q.retryFailed(id)).outcome).toBe('conflict')
  })
})
