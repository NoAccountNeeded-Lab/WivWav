import { QUEUES } from '@wivwav/queue'
import type {
  JobContext,
  JobProcessor,
  QueueAdapter,
  QueueFactory,
  WorkerAdapter,
} from '@wivwav/queue'
import { describe, expect, it, vi } from 'vitest'
import { registerGatewayWorkers } from './gateway-workers.js'
import type { WorkerDispatcher } from './dispatcher.js'

/**
 * Captures each queue's registered processor and every `add()` call, so
 * tests can invoke a gateway processor directly (MockQueueFactory discards
 * the processor entirely, so it can't exercise this).
 */
function createFakeQueueFactory() {
  const processors = new Map<string, JobProcessor>()
  const added: { queue: string; data: unknown; options?: unknown }[] = []

  const factory: QueueFactory = {
    createQueue: (name: string): QueueAdapter =>
      ({
        name,
        add: async (data: unknown, options?: unknown) => {
          added.push({ queue: name, data, options })
          return 'job-id'
        },
      }) as unknown as QueueAdapter,
    createWorker: <T = unknown>(name: string, processor: JobProcessor<T>): WorkerAdapter => {
      processors.set(name, processor as JobProcessor)
      return { close: async () => {} }
    },
    close: async () => {},
  }

  return { factory, processors, added }
}

function fakeContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 'job-1',
    log: async () => {},
    updateProgress: async () => {},
    ...overrides,
  }
}

function fakeContextWithoutJobId(): JobContext {
  return { log: async () => {}, updateProgress: async () => {} }
}

describe('registerGatewayWorkers', () => {
  it('registers a BullMQ consumer for all three phase-1 queues', () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)
    expect([...processors.keys()].sort()).toEqual(
      [QUEUES.SOURCE_SCRAPE, QUEUES.DETAIL_CRAWL, QUEUES.DETAIL_EXTRACT].sort(),
    )
  })

  it('dispatches with the sourceId pulled from job data and chromium: true', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.DETAIL_CRAWL)!
    await processor({ sourceId: 'src-1' }, fakeContext({ jobId: 'job-42' }))

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      QUEUES.DETAIL_CRAWL,
      'job-42',
      { sourceId: 'src-1' },
      {
        chromium: true,
        sourceId: 'src-1',
      },
    )
  })

  it('throws when the job context has no jobId (cannot build a correlation id)', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.SOURCE_SCRAPE)!
    await expect(processor({ sourceId: 'src-1' }, fakeContextWithoutJobId())).rejects.toThrow(
      'cannot build a correlation id',
    )
  })

  it('enqueues listing-sync and listing-resolve after a SOURCE_SCRAPE completion that changed listings', async () => {
    const { factory, processors, added } = createFakeQueueFactory()
    const dispatcher = {
      dispatch: vi.fn(async () => ({ listingsChanged: true })),
    } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.SOURCE_SCRAPE)!
    await processor({ sourceId: 'src-1' }, fakeContext({ jobId: 'job-1', runId: 'run-1' }))

    expect(added.map((a) => a.queue).sort()).toEqual(
      [QUEUES.LISTING_RESOLVE, QUEUES.LISTING_SYNC].sort(),
    )
    const resolveJob = added.find((a) => a.queue === QUEUES.LISTING_RESOLVE)
    expect(resolveJob?.data).toEqual({ sourceId: 'src-1', parentRunId: 'run-1' })
  })

  it('does not enqueue follow-on jobs when SOURCE_SCRAPE reports listingsChanged: false', async () => {
    const { factory, processors, added } = createFakeQueueFactory()
    const dispatcher = {
      dispatch: vi.fn(async () => ({ listingsChanged: false })),
    } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.SOURCE_SCRAPE)!
    await processor({ sourceId: 'src-1' }, fakeContext())

    expect(added).toHaveLength(0)
  })

  it('does not enqueue follow-on jobs when the completion result is missing or malformed', async () => {
    const { factory, processors, added } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.SOURCE_SCRAPE)!
    await processor({ sourceId: 'src-1' }, fakeContext())

    expect(added).toHaveLength(0)
  })

  it('never enqueues follow-on jobs for DETAIL_CRAWL/DETAIL_EXTRACT completions', async () => {
    const { factory, processors, added } = createFakeQueueFactory()
    const dispatcher = {
      dispatch: vi.fn(async () => ({ listingsChanged: true })),
    } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.DETAIL_EXTRACT)!
    await processor({ sourceId: 'src-1' }, fakeContext())

    expect(added).toHaveLength(0)
  })
})
