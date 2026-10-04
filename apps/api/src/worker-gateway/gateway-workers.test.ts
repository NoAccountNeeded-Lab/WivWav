import { QUEUES, RetryJobSignal } from '@wivwav/queue'
import type {
  JobContext,
  JobProcessor,
  QueueAdapter,
  QueueFactory,
  WorkerAdapter,
} from '@wivwav/queue'
import { SCRAPER_SOURCE_REGISTRY } from '@wivwav/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ESCALATION_WAIT_LIMIT_MS,
  GATEWAY_QUEUES,
  registerGatewayWorkers,
} from './gateway-workers.js'
import { CapabilityEscalationError, WorkerDispatcher } from './dispatcher.js'
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

  const dispatch = vi.fn<WorkerDispatcher['dispatch']>()
  let sourceScrapeProcessor: JobProcessor | undefined

  beforeEach(() => {
    dispatch.mockReset()
    dispatch.mockResolvedValue(undefined)
    const { factory, processors } = createFakeQueueFactory()
    registerGatewayWorkers(factory, { dispatch } as unknown as WorkerDispatcher)
    sourceScrapeProcessor = processors.get(QUEUES.SOURCE_SCRAPE)
  })

  /** Runs the real gateway processor with the job data the API enqueues for a source. */
  async function requirementsFor(key: string) {
    const definition = SCRAPER_SOURCE_REGISTRY.find((entry) => entry.key === key)
    if (definition === undefined) throw new Error(`unknown source ${key}`)
    if (sourceScrapeProcessor === undefined) throw new Error('SOURCE_SCRAPE processor not registered')
    await sourceScrapeProcessor(
      { sourceId: key, requiresBrowser: definition.requiresBrowser },
      fakeContext({ jobId: `job-${key}` }),
    )
    const call = dispatch.mock.calls[0]
    if (call === undefined) throw new Error('dispatch was not called')
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

describe('SOURCE_SCRAPE capability escalation (#1043)', () => {
  const escalation = { capability: 'chromium' as const, reason: 'blocked over http' }

  function escalatingDispatcher(dispatch = vi.fn()) {
    return { dispatch } as unknown as WorkerDispatcher & { dispatch: typeof dispatch }
  }

  it('persists the chromium requirement into the job payload and requeues without consuming an attempt', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn().mockRejectedValueOnce(new CapabilityEscalationError(escalation))
    registerGatewayWorkers(factory, escalatingDispatcher(dispatch), undefined, { now: () => 1000 })
    const updateData = vi.fn(async () => {})

    const err = await processors
      .get(QUEUES.SOURCE_SCRAPE)!({ sourceId: 'blvd', requiresBrowser: false }, fakeContext({ updateData }))
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(RetryJobSignal)
    expect(updateData).toHaveBeenCalledTimes(1)
    expect(updateData).toHaveBeenCalledWith({
      requiresBrowser: true,
      capabilityEscalation: { capability: 'chromium', reason: 'blocked over http', at: 1000 },
    })
  })

  it('re-dispatches an escalated job (same job id) requiring chromium even if requiresBrowser is stale', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn(async () => ({ listingsChanged: false }))
    registerGatewayWorkers(factory, escalatingDispatcher(dispatch))
    const data = {
      sourceId: 'blvd',
      requiresBrowser: false,
      capabilityEscalation: { capability: 'chromium', reason: 'x', at: Date.now() },
    }
    await processors.get(QUEUES.SOURCE_SCRAPE)!(data, fakeContext({ jobId: 'job-9' }))
    expect(dispatch).toHaveBeenCalledWith(QUEUES.SOURCE_SCRAPE, 'job-9', data, {
      chromium: true, httpEnrich: false, sourceId: 'blvd',
    })
  })

  it('a second escalation request after escalating fails clearly instead of redispatching', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn().mockRejectedValue(new CapabilityEscalationError(escalation))
    registerGatewayWorkers(factory, escalatingDispatcher(dispatch))
    const updateData = vi.fn(async () => {})
    const data = {
      sourceId: 'blvd',
      capabilityEscalation: { capability: 'chromium', reason: 'first', at: Date.now() },
    }
    const err = await processors
      .get(QUEUES.SOURCE_SCRAPE)!(data, fakeContext({ updateData }))
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(RetryJobSignal)
    expect((err as Error).message).toContain('already escalated')
    expect(updateData).not.toHaveBeenCalled()
  })

  it('fails when the backend cannot persist the requirement rather than looping', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn().mockRejectedValue(new CapabilityEscalationError(escalation))
    registerGatewayWorkers(factory, escalatingDispatcher(dispatch))
    const err = await processors
      .get(QUEUES.SOURCE_SCRAPE)!({ sourceId: 'blvd', requiresBrowser: false }, fakeContext())
      .catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(RetryJobSignal)
    expect((err as Error).message).toContain('cannot persist')
  })

  it('keeps requeueing an escalated job while waiting for a capable worker, then fails past the wait limit', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn().mockRejectedValue(new RetryJobSignal(15_000, 'no eligible worker connected'))
    let now = 10_000
    registerGatewayWorkers(factory, escalatingDispatcher(dispatch), undefined, { now: () => now })
    const data = {
      sourceId: 'blvd',
      capabilityEscalation: { capability: 'chromium', reason: 'blocked', at: 10_000 },
    }
    const processor = processors.get(QUEUES.SOURCE_SCRAPE)!

    now = 10_000 + ESCALATION_WAIT_LIMIT_MS
    await expect(processor(data, fakeContext())).rejects.toBeInstanceOf(RetryJobSignal)

    now = 10_000 + ESCALATION_WAIT_LIMIT_MS + 1
    const err = await processor(data, fakeContext()).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(RetryJobSignal)
    expect((err as Error).message).toContain('none completed it')
  })

  it('does not bound ordinary (never-escalated) no-worker waits', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn().mockRejectedValue(new RetryJobSignal(15_000, 'no eligible worker connected'))
    registerGatewayWorkers(factory, escalatingDispatcher(dispatch), undefined, { now: () => 1e15 })
    await expect(
      processors.get(QUEUES.SOURCE_SCRAPE)!({ sourceId: 'blvd', requiresBrowser: false }, fakeContext()),
    ).rejects.toBeInstanceOf(RetryJobSignal)
  })

  it('a legacy payload with no requiresBrowser field still dispatches conservatively with chromium: true', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn(async () => undefined)
    registerGatewayWorkers(factory, escalatingDispatcher(dispatch))
    await processors.get(QUEUES.SOURCE_SCRAPE)!({ sourceId: 'legacy' }, fakeContext())
    expect(dispatch).toHaveBeenCalledWith(QUEUES.SOURCE_SCRAPE, 'job-1', { sourceId: 'legacy' }, {
      chromium: true, httpEnrich: false, sourceId: 'legacy',
    })
  })

  it.each([QUEUES.DETAIL_CRAWL, QUEUES.DETAIL_EXTRACT])('%s stays unconditionally browser-gated', async (queue) => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn(async () => undefined)
    registerGatewayWorkers(factory, escalatingDispatcher(dispatch))
    await processors.get(queue)!({ sourceId: 's', requiresBrowser: false }, fakeContext())
    expect(dispatch).toHaveBeenCalledWith(queue, 'job-1', expect.anything(), expect.objectContaining({ chromium: true }))
  })
})

describe('two-worker BLVD handoff (real dispatcher + registry)', () => {
  function connect(registry: WorkerRegistry, id: string, chromium: boolean): RegisteredWorker {
    const worker: RegisteredWorker = {
      connectionId: `conn-${id}`,
      workerId: id,
      workerName: id,
      capabilities: { chromium, httpEnrich: false, maxConcurrentJobs: 2 },
      inFlight: new Set(),
      lastHeartbeatAt: new Date(),
      send: vi.fn(),
    }
    registry.register(worker)
    return worker
  }
  const lastDispatch = (w: RegisteredWorker) =>
    (w.send as unknown as { mock: { calls: [{ dispatchId: string; correlationId: string }][] } }).mock.calls.at(-1)![0]

  /** Mimics BullMQ: the persisted payload is what each re-run of the processor sees. */
  function harness() {
    const { factory, processors, added } = createFakeQueueFactory()
    const registry = new WorkerRegistry()
    const dispatcher = new WorkerDispatcher(registry, 10_000)
    registerGatewayWorkers(factory, dispatcher)
    let payload: Record<string, unknown> = { sourceId: 'blvd', requiresBrowser: false }
    const context = () =>
      fakeContext({
        jobId: 'job-77',
        updateData: async (patch) => {
          payload = { ...payload, ...patch }
        },
      })
    const run = () => processors.get(QUEUES.SOURCE_SCRAPE)!(payload, context())
    return { registry, dispatcher, run, added, payload: () => payload }
  }

  it('hands a blocked job from the chromium-free worker to the capable worker once, same job identity, one follow-on enqueue', async () => {
    const { registry, dispatcher, run, added, payload } = harness()
    const free = connect(registry, 'free', false)
    const capable = connect(registry, 'capable', true)

    // Attempt 1 lands on the chromium-free worker (requiresBrowser: false), which escalates.
    const first = run().catch((e: unknown) => e)
    await Promise.resolve()
    expect(free.send).toHaveBeenCalledTimes(1)
    expect(capable.send).not.toHaveBeenCalled()
    const d1 = lastDispatch(free)
    expect(
      dispatcher.complete(d1.correlationId, d1.dispatchId, false, 'x', undefined, {
        capability: 'chromium', reason: 'blocked over http',
      }),
    ).toBe(true)
    expect(await first).toBeInstanceOf(RetryJobSignal)
    expect(payload()['requiresBrowser']).toBe(true)
    expect(added).toHaveLength(0) // nothing published for an escalation

    // The stale worker cannot complete the old attempt any more.
    expect(dispatcher.complete(d1.correlationId, d1.dispatchId, true, undefined, { listingsChanged: true })).toBe(false)

    // Attempt 2 (same job id => same correlation id) goes to the capable worker only.
    const second = run()
    await Promise.resolve()
    expect(free.send).toHaveBeenCalledTimes(1)
    expect(capable.send).toHaveBeenCalledTimes(1)
    const d2 = lastDispatch(capable)
    expect(d2.correlationId).toBe(d1.correlationId)
    expect(d2.dispatchId).not.toBe(d1.dispatchId)
    dispatcher.complete(d2.correlationId, d2.dispatchId, true, undefined, { listingsChanged: true })
    await second

    // Follow-ons enqueued exactly once, only after the real completion.
    expect(added.map((a) => a.queue).sort()).toEqual([QUEUES.LISTING_RESOLVE, QUEUES.LISTING_SYNC].sort())
    // A late duplicate from the capable worker is rejected (already settled).
    expect(dispatcher.complete(d2.correlationId, d2.dispatchId, true)).toBe(false)
  })

  it('with no capable worker connected, the escalated job requeues without dispatching and stays bounded', async () => {
    const { registry, dispatcher, run, payload } = harness()
    const free = connect(registry, 'free', false)
    const first = run().catch((e: unknown) => e)
    await Promise.resolve()
    const d1 = lastDispatch(free)
    dispatcher.complete(d1.correlationId, d1.dispatchId, false, undefined, undefined, {
      capability: 'chromium', reason: 'blocked',
    })
    await first

    await expect(run()).rejects.toBeInstanceOf(RetryJobSignal)
    expect(free.send).toHaveBeenCalledTimes(1) // never falls back to the chromium-free worker
    expect((payload()['capabilityEscalation'] as { at: number }).at).toBeGreaterThan(0)
  })

  it('a worker disconnecting mid-attempt requeues without consuming an attempt and rejects its late completion', async () => {
    const { registry, dispatcher, run } = harness()
    const capable = connect(registry, 'capable', true)
    const attempt = run().catch((e: unknown) => e)
    await Promise.resolve()
    const d = lastDispatch(capable)
    // Same order as the WS close handler: unregister, then failConnection.
    registry.unregister('conn-capable')
    dispatcher.failConnection('conn-capable', 'worker disconnected before reporting completion')
    expect(await attempt).toBeInstanceOf(RetryJobSignal)
    expect(dispatcher.complete(d.correlationId, d.dispatchId, true, undefined, { listingsChanged: true })).toBe(false)
  })

  it('survives a coordinator restart: a fresh dispatcher/registry honours the persisted requirement, with no leftover pin state', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const registry = new WorkerRegistry()
    const dispatcher = new WorkerDispatcher(registry, 10_000)
    registerGatewayWorkers(factory, dispatcher)
    const free = connect(registry, 'free', false)
    const capable = connect(registry, 'capable', true)
    // Persisted payload as left behind by an escalation before the "restart".
    const persisted = {
      sourceId: 'blvd',
      requiresBrowser: true,
      capabilityEscalation: { capability: 'chromium', reason: 'blocked', at: Date.now() },
    }
    const run = processors.get(QUEUES.SOURCE_SCRAPE)!(persisted, fakeContext({ jobId: 'job-77' }))
    await Promise.resolve()
    expect(free.send).not.toHaveBeenCalled()
    const d = lastDispatch(capable)
    dispatcher.complete(d.correlationId, d.dispatchId, true, undefined, { listingsChanged: false })
    await run
    // Nothing retained in the dispatcher after settle (pin cleanup is the job payload's lifetime).
    expect(capable.inFlight.size).toBe(0)
    expect(registry.tryAcquireSourceLock('blvd', 'x')).toBe(true)
  })

  it('a cancelled job (payload write fails) surfaces the error instead of requeueing', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const dispatch = vi.fn().mockRejectedValue(
      new CapabilityEscalationError({ capability: 'chromium', reason: 'blocked' }),
    )
    registerGatewayWorkers(factory, { dispatch } as unknown as WorkerDispatcher)
    const updateData = vi.fn(async () => {
      throw new Error('Missing key for job job-1')
    })
    const err = await processors
      .get(QUEUES.SOURCE_SCRAPE)!({ sourceId: 'blvd', requiresBrowser: false }, fakeContext({ updateData }))
      .catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(RetryJobSignal)
    expect((err as Error).message).toContain('Missing key')
  })

  it('a worker draining for shutdown refuses the escalated redispatch without consuming an attempt or clearing the requirement', async () => {
    const { factory, processors } = createFakeQueueFactory()
    const registry = new WorkerRegistry()
    const dispatcher = new WorkerDispatcher(registry, 10_000)
    registerGatewayWorkers(factory, dispatcher)
    const capable = connect(registry, 'capable', true)
    const persisted = {
      sourceId: 'blvd',
      capabilityEscalation: { capability: 'chromium', reason: 'blocked', at: Date.now() },
    }
    const run = processors.get(QUEUES.SOURCE_SCRAPE)!(persisted, fakeContext({ jobId: 'job-5' })).catch((e: unknown) => e)
    await Promise.resolve()
    const d = lastDispatch(capable)
    dispatcher.refuse(d.correlationId, d.dispatchId, 'worker is draining for shutdown')
    expect(await run).toBeInstanceOf(RetryJobSignal)
  })
})
