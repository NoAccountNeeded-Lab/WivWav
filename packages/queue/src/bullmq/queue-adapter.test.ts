import { describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import { getQueuePolicy } from '../policies.js'
import { BullMQQueueAdapter } from './queue-adapter.js'

function makeQueue(overrides: Record<string, unknown> = {}): Queue {
  return {
    name: 'detail-crawl',
    getJobSchedulers: vi.fn(async () => []),
    upsertJobScheduler: vi.fn(async () => ({})),
    removeJobScheduler: vi.fn(async () => false),
    removeRepeatableByKey: vi.fn(async () => false),
    ...overrides,
  } as unknown as Queue
}

describe('BullMQQueueAdapter repeatable jobs', () => {
  it('uses scheduler keys as identities when BullMQ 5 metadata has null ids', async () => {
    const queue = makeQueue({
      getJobSchedulers: vi.fn(async () => [
        {
          key: 'blvd-crawl',
          name: 'detail-crawl',
          id: null,
          pattern: '0 * * * *',
          iterationCount: 1,
        },
        {
          key: 'mw-crawl',
          name: 'detail-crawl',
          id: null,
          pattern: '0 * * * *',
          iterationCount: 1,
        },
      ]),
    })
    const adapter = new BullMQQueueAdapter(queue, getQueuePolicy('detail-crawl'))

    const jobs = await adapter.getRepeatableJobs()

    expect(jobs.map((job) => job.id)).toEqual(['blvd-crawl', 'mw-crawl'])
  })

  it('upserts a scheduler with the caller supplied job id and template', async () => {
    const upsertJobScheduler = vi.fn(async () => ({}))
    const adapter = new BullMQQueueAdapter(
      makeQueue({ upsertJobScheduler }),
      getQueuePolicy('detail-crawl'),
    )

    await adapter.addRepeatable(
      'detail-extract',
      { sourceId: 'mw-id' },
      '*/5 * * * *',
      'America/New_York',
      'mw-extract',
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    )

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'mw-extract',
      { pattern: '*/5 * * * *', tz: 'America/New_York' },
      {
        name: 'detail-extract',
        data: { sourceId: 'mw-id' },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 300,
        },
      },
    )
  })

  it('falls back to legacy removal only when scheduler removal misses', async () => {
    const removeJobScheduler = vi.fn(async () => false)
    const removeRepeatableByKey = vi.fn(async () => true)
    const adapter = new BullMQQueueAdapter(
      makeQueue({
        removeJobScheduler,
        removeRepeatableByKey,
      }),
      getQueuePolicy('detail-crawl'),
    )

    const removed = await adapter.removeRepeatableByKey('legacy-hash')

    expect(removed).toBe(true)
    expect(removeJobScheduler).toHaveBeenCalledWith('legacy-hash')
    expect(removeRepeatableByKey).toHaveBeenCalledWith('legacy-hash')
  })

  it('does not call legacy removal after scheduler removal succeeds', async () => {
    const removeJobScheduler = vi.fn(async () => true)
    const removeRepeatableByKey = vi.fn(async () => true)
    const adapter = new BullMQQueueAdapter(
      makeQueue({
        removeJobScheduler,
        removeRepeatableByKey,
      }),
      getQueuePolicy('detail-crawl'),
    )

    const removed = await adapter.removeRepeatableByKey('mw-crawl')

    expect(removed).toBe(true)
    expect(removeRepeatableByKey).not.toHaveBeenCalled()
  })
})

describe('BullMQQueueAdapter close (#995)', () => {
  // BullMQ's `Queue#close()` and `Queue#disconnect()` have complementary
  // hang risks: `close()` blocks on a graceful QUIT reply once the
  // connection has reached "ready", while `disconnect()` blocks awaiting
  // the not-yet-resolved connection promise if the handshake never
  // completed. `BullMQQueueAdapter#close()` races both so at least one
  // resolves regardless of which connection state the backend is stuck in.

  it('resolves via disconnect() when close() hangs (connection reached "ready", then a command stalled)', async () => {
    const close = vi.fn(() => new Promise<void>(() => {})) // never settles
    const disconnect = vi.fn(async () => {})
    const adapter = new BullMQQueueAdapter(makeQueue({ close, disconnect }), getQueuePolicy('detail-crawl'))

    await adapter.close()

    expect(close).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
  })

  it('resolves via close() when disconnect() hangs (connection never reached "ready")', async () => {
    const close = vi.fn(async () => {})
    const disconnect = vi.fn(() => new Promise<void>(() => {})) // never settles
    const adapter = new BullMQQueueAdapter(makeQueue({ close, disconnect }), getQueuePolicy('detail-crawl'))

    await adapter.close()

    expect(close).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
  })
})
