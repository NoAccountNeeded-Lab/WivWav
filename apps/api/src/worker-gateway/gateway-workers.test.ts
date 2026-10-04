import { QUEUES } from '@wivwav/queue'
import type {
  JobContext,
  JobProcessor,
  QueueAdapter,
  QueueFactory,
  WorkerAdapter,
} from '@wivwav/queue'
import { SCRAPER_SOURCE_REGISTRY } from '@wivwav/types'
import { describe, expect, it, vi } from 'vitest'
import { GATEWAY_QUEUES, registerGatewayWorkers } from './gateway-workers.js'
import type { WorkerDispatcher } from './dispatcher.js'
import { WorkerRegistry } from './registry.js'
import type { RegisteredWorker } from './registry.js'

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
  it('registers a BullMQ consumer for every gateway queue (phase-1 chromium + phase-2 httpEnrich)', () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)
    expect([...processors.keys()].sort()).toEqual([...GATEWAY_QUEUES].sort())
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
        httpEnrich: false,
        sourceId: 'src-1',
      },
    )
  })

  it('dispatches an outbound-HTTP queue with chromium: false and httpEnrich: true', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.NHTSA_RECALLS)!
    await processor({}, fakeContext({ jobId: 'job-99' }))

    expect(dispatcher.dispatch).toHaveBeenCalledWith(QUEUES.NHTSA_RECALLS, 'job-99', {}, {
      chromium: false,
      httpEnrich: true,
      sourceId: undefined,
    })
  })

  it('dispatches SOURCE_SCRAPE with chromium: true when the job data says requiresBrowser: true (#1041)', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.SOURCE_SCRAPE)!
    await processor({ sourceId: 'blvd-1', requiresBrowser: true }, fakeContext({ jobId: 'job-1' }))

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      QUEUES.SOURCE_SCRAPE,
      'job-1',
      { sourceId: 'blvd-1', requiresBrowser: true },
      { chromium: true, httpEnrich: false, sourceId: 'blvd-1' },
    )
  })

  it('dispatches SOURCE_SCRAPE with chromium: false when the job data says requiresBrowser: false (#1041)', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.SOURCE_SCRAPE)!
    await processor(
      { sourceId: 'mobilityworks-1', requiresBrowser: false },
      fakeContext({ jobId: 'job-2' }),
    )

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      QUEUES.SOURCE_SCRAPE,
      'job-2',
      { sourceId: 'mobilityworks-1', requiresBrowser: false },
      { chromium: false, httpEnrich: false, sourceId: 'mobilityworks-1' },
    )
  })

  it('falls back to chromium: true for a SOURCE_SCRAPE job with no requiresBrowser field (pre-#1041 payload)', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const processor = processors.get(QUEUES.SOURCE_SCRAPE)!
    await processor({ sourceId: 'src-1' }, fakeContext({ jobId: 'job-3' }))

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      QUEUES.SOURCE_SCRAPE,
      'job-3',
      { sourceId: 'src-1' },
      { chromium: true, httpEnrich: false, sourceId: 'src-1' },
    )
  })

  it('ignores a requiresBrowser: false field on DETAIL_CRAWL/DETAIL_EXTRACT — always chromium: true', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as WorkerDispatcher
    registerGatewayWorkers(factory, dispatcher)

    const detailCrawl = processors.get(QUEUES.DETAIL_CRAWL)!
    await detailCrawl({ sourceId: 'src-1', requiresBrowser: false }, fakeContext({ jobId: 'job-4' }))

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      QUEUES.DETAIL_CRAWL,
      'job-4',
      { sourceId: 'src-1', requiresBrowser: false },
      { chromium: true, httpEnrich: false, sourceId: 'src-1' },
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

describe('per-source chromium gating end to end with WorkerRegistry.pickWorker (#1040)', () => {
  const chromiumFreeWorker: RegisteredWorker = {
    connectionId: 'light',
    workerId: 'w-light',
    workerName: 'volunteer',
    capabilities: { chromium: false, httpEnrich: false, maxConcurrentJobs: 2 },
    inFlight: new Set(),
    lastHeartbeatAt: new Date(),
    send: vi.fn(),
  }

  /** Runs the real gateway processor with the job data the API enqueues for a source. */
  async function requirementsFor(key: string) {
    const definition = SCRAPER_SOURCE_REGISTRY.find((entry) => entry.key === key)
    if (definition === undefined) throw new Error(`unknown source ${key}`)
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn(async () => undefined)
    registerGatewayWorkers(factory, { dispatch } as unknown as WorkerDispatcher)
    const processor = processors.get(QUEUES.SOURCE_SCRAPE)!
    await processor(
      { sourceId: key, requiresBrowser: definition.requiresBrowser },
      fakeContext({ jobId: `job-${key}` }),
    )
    const call = dispatch.mock.calls[0] as unknown as [string, string, unknown, { chromium: boolean }]
    return call[3]
  }

  it.each(['ebay-motors', 'mobilityworks', 'ams-vans-classifieds', 'mobility-van-sales'])(
    'selects a chromium=false worker for a %s source-scrape job',
    async (key) => {
      const registry = new WorkerRegistry()
      registry.register(chromiumFreeWorker)
      expect(registry.pickWorker(await requirementsFor(key))?.connectionId).toBe('light')
    },
  )

  it.each(['freedom-motors', 'superior-van'])(
    'rejects a chromium=false worker for a %s source-scrape job',
    async (key) => {
      const registry = new WorkerRegistry()
      registry.register(chromiumFreeWorker)
      expect(registry.pickWorker(await requirementsFor(key))).toBeUndefined()
    },
  )
})
