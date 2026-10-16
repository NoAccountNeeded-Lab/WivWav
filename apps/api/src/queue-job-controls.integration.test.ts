import { afterAll, describe, expect, it, vi } from 'vitest'
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

// Minimal view of the underlying BullMQ Queue (apps/api does not depend on bullmq directly).
interface RawJob { remove(): Promise<void> }
interface RawQueue {
  add(name: string, data: object, opts: object): Promise<{ id?: string }>
  getJob(id: string): Promise<RawJob | undefined>
  getJobState(id: string): Promise<string>
  toKey(type: string): string
  backend: { client: Promise<{ del(key: string): Promise<number> }> }
}
function bullOf(q: QueueAdapter): RawQueue {
  return (q as unknown as { getBullMQQueue(): RawQueue }).getBullMQQueue()
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

  it('does not delete a job that completed, or an active job whose lock expired', async () => {
    const q = freshQueue()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let started = false
    workers.push(factory.createWorker(q.name, async () => { started = true; await gate }))
    const id = await q.add({})
    await until(async () => started)
    // Lock expired while the job is still in the active list.
    const bull = bullOf(q)
    await (await bull.backend.client).del(bull.toKey(`${id}:lock`))
    expect((await q.removeQueued(id)).outcome).toBe('conflict')
    expect(await stateOf(q, id)).toBe('active')
    release()
  })

  it('does not delete a job that already completed', async () => {
    const q = freshQueue()
    workers.push(factory.createWorker(q.name, async () => {}))
    const id = await q.add({})
    await until(async () => (await stateOf(q, id)) === 'completed')
    expect((await q.removeQueued(id)).outcome).toBe('conflict')
    expect(await stateOf(q, id)).toBe('completed')
  })

  it('cancels prioritized jobs on normal and paused queues', async () => {
    for (const paused of [false, true]) {
      const q = freshQueue()
      if (paused) await q.pause()
      const job = await bullOf(q).add('x', {}, { priority: 5 })
      const id = job.id ?? ''
      expect(await bullOf(q).getJobState(id)).toBe('prioritized')
      expect(await q.removeQueued(id)).toEqual({ outcome: 'ok' })
      expect(await bullOf(q).getJob(id)).toBeUndefined()
    }
  })

  it('returns not_found when the job vanishes between lookup and action', async () => {
    const q = freshQueue()
    const failedId = await q.add({}, { delay: 60_000 })
    const bull = bullOf(q)
    const stale = await bull.getJob(failedId)
    await stale?.remove()
    // Only the adapter's first lookup is stale; later lookups see reality.
    const spy = vi.spyOn(bull, 'getJob')
    spy.mockResolvedValueOnce(stale)
    expect((await q.makeReady(failedId)).outcome).toBe('not_found')
    spy.mockResolvedValueOnce(stale)
    expect((await q.retryFailed(failedId)).outcome).toBe('not_found')
    spy.mockRestore()
    expect((await q.removeQueued(failedId)).outcome).toBe('not_found')
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
