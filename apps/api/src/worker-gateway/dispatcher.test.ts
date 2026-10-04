import { RetryJobSignal } from '@wivwav/queue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkerDispatcher,
  NO_WORKER_RETRY_DELAY_MS,
  CapabilityEscalationError,
} from './dispatcher.js'
import { WorkerRegistry, type RegisteredWorker } from './registry.js'

function connectWorker(
  registry: WorkerRegistry,
  overrides: Partial<RegisteredWorker> = {},
): RegisteredWorker {
  const worker: RegisteredWorker = {
    connectionId: 'conn-1',
    workerId: 'worker-1',
    workerName: 'laptop',
    capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 2 },
    inFlight: new Set(),
    lastHeartbeatAt: new Date(),
    send: vi.fn(),
    ...overrides,
  }
  registry.register(worker)
  return worker
}

/** Reads the dispatchId the dispatcher generated for the most recent send() call. */
function dispatchIdFrom(worker: RegisteredWorker): string {
  const send = worker.send as unknown as { mock: { calls: unknown[][] } }
  const lastCall = send.mock.calls.at(-1)?.[0] as { dispatchId: string }
  return lastCall.dispatchId
}

describe('WorkerDispatcher.dispatch', () => {
  it('throws RetryJobSignal when no worker is connected', async () => {
    const registry = new WorkerRegistry()
    const dispatcher = new WorkerDispatcher(registry, 1000)
    await expect(dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })).rejects.toThrow(
      RetryJobSignal,
    )
  })

  it('sets the RetryJobSignal delay to NO_WORKER_RETRY_DELAY_MS', async () => {
    const registry = new WorkerRegistry()
    const dispatcher = new WorkerDispatcher(registry, 1000)
    await expect(
      dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true }),
    ).rejects.toMatchObject({
      delayMs: NO_WORKER_RETRY_DELAY_MS,
    })
  })

  it('sends a job-dispatch message to the picked worker, with a fresh dispatchId', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    void dispatcher.dispatch(
      'detail-crawl',
      '1',
      { sourceId: 'src-1' },
      { chromium: true, sourceId: 'src-1' },
    )
    await Promise.resolve()
    expect(worker.send).toHaveBeenCalledWith({
      type: 'job-dispatch',
      correlationId: 'detail-crawl:1',
      dispatchId: expect.any(String),
      queueName: 'detail-crawl',
      payload: { sourceId: 'src-1' },
    })
  })

  it('rejects with RetryJobSignal, and releases the source lock, when send() throws synchronously', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry, {
      send: vi.fn(() => {
        throw new Error('WebSocket is not open')
      }),
    })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    await expect(
      dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true, sourceId: 'src-1' }),
    ).rejects.toThrow(RetryJobSignal)
    expect(worker.inFlight.size).toBe(0)
    expect(registry.tryAcquireSourceLock('src-1', 'detail-crawl:2')).toBe(true)
  })

  it('resolves when complete(success: true) is called for the correlation id', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    await Promise.resolve()
    dispatcher.complete('detail-crawl:1', dispatchIdFrom(worker), true)
    await expect(promise).resolves.toBeUndefined()
  })

  it('resolves with the worker-reported result', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('source-scrape', '1', {}, { chromium: true })
    await Promise.resolve()
    dispatcher.complete('source-scrape:1', dispatchIdFrom(worker), true, undefined, {
      listingsChanged: true,
    })
    await expect(promise).resolves.toEqual({ listingsChanged: true })
  })

  it('rejects when complete(success: false) is called', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    await Promise.resolve()
    dispatcher.complete('detail-crawl:1', dispatchIdFrom(worker), false, 'browser crashed')
    await expect(promise).rejects.toThrow('browser crashed')
  })

  it('complete() returns false for an unknown correlation id', () => {
    const registry = new WorkerRegistry()
    const dispatcher = new WorkerDispatcher(registry, 1000)
    expect(dispatcher.complete('unknown:1', 'any-dispatch-id', true)).toBe(false)
  })

  it('complete() returns false and does not settle when dispatchId is stale', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry, {
      capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 5 },
    })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    await Promise.resolve()
    const staleDispatchId = dispatchIdFrom(worker)

    // Connection drops and the job is re-dispatched to (in this test, the
    // same) worker under a fresh dispatchId.
    dispatcher.failConnection('conn-1', 'worker disconnected before reporting completion')
    const second = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    await Promise.resolve()

    // The original (now-dead) attempt's late completion must not settle the
    // re-dispatched attempt.
    expect(dispatcher.complete('detail-crawl:1', staleDispatchId, true)).toBe(false)
    await expect(promise).rejects.toThrow(RetryJobSignal)

    dispatcher.complete('detail-crawl:1', dispatchIdFrom(worker), true)
    await expect(second).resolves.toBeUndefined()
  })

  it('refuse() with a stale dispatchId does not touch the current pending dispatch', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry, {
      capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 5 },
    })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const first = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    await Promise.resolve()
    const staleDispatchId = dispatchIdFrom(worker)

    dispatcher.failConnection('conn-1', 'worker disconnected before reporting completion')
    await expect(first).rejects.toThrow(RetryJobSignal)
    const second = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    await Promise.resolve()

    dispatcher.refuse('detail-crawl:1', staleDispatchId, 'stale refusal')
    dispatcher.complete('detail-crawl:1', dispatchIdFrom(worker), true)
    await expect(second).resolves.toBeUndefined()
  })

  it('throws RetryJobSignal when the source lock is already held', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    void dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true, sourceId: 'src-1' })
    await expect(
      dispatcher.dispatch('detail-crawl', '2', {}, { chromium: true, sourceId: 'src-1' }),
    ).rejects.toThrow(RetryJobSignal)
  })

  it('releases the source lock once the in-flight dispatch completes', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const first = dispatcher.dispatch(
      'detail-crawl',
      '1',
      {},
      { chromium: true, sourceId: 'src-1' },
    )
    await Promise.resolve()
    dispatcher.complete('detail-crawl:1', dispatchIdFrom(worker), true)
    await first
    expect(registry.tryAcquireSourceLock('src-1', 'detail-crawl:2')).toBe(true)
  })

  it('refuse() rejects the pending dispatch with RetryJobSignal and the worker-supplied reason', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    await Promise.resolve()
    dispatcher.refuse('detail-crawl:1', dispatchIdFrom(worker), 'at capacity')
    await expect(promise).rejects.toThrow(RetryJobSignal)
    await expect(promise).rejects.toThrow('at capacity')
  })

  it('failConnection() rejects every dispatch in flight on that connection, without consuming a retry attempt', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    dispatcher.failConnection('conn-1', 'worker disconnected')
    await expect(promise).rejects.toThrow(RetryJobSignal)
    await expect(promise).rejects.toThrow('worker disconnected')
  })

  it('failConnection() only affects dispatches on the given connection, not other workers', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry, { connectionId: 'conn-1' })
    const worker2 = connectWorker(registry, { connectionId: 'conn-2' })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    // Force each dispatch onto a specific worker by exhausting the other's capacity first.
    const first = dispatcher.dispatch(
      'detail-crawl',
      '1',
      {},
      { chromium: true, sourceId: 'src-1' },
    )
    const second = dispatcher.dispatch(
      'detail-crawl',
      '2',
      {},
      { chromium: true, sourceId: 'src-2' },
    )
    await Promise.resolve()
    dispatcher.failConnection('conn-1', 'worker disconnected')
    dispatcher.complete('detail-crawl:2', dispatchIdFrom(worker2), true)
    const settled = await Promise.allSettled([first, second])
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'fulfilled'])
  })

  it('a stale pending dispatch is superseded by a re-dispatch of the same correlation id', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry, {
      capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 5 },
    })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const stale = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    void dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    await expect(stale).rejects.toThrow('superseded')
  })
})

describe('WorkerDispatcher httpEnrich routing (#962)', () => {
  it('routes to an httpEnrich-capable, non-chromium worker', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry, {
      capabilities: { chromium: false, httpEnrich: true, maxConcurrentJobs: 2 },
    })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    void dispatcher.dispatch('nhtsa-recalls', '1', {}, { chromium: false, httpEnrich: true })
    await Promise.resolve()
    expect(worker.send).toHaveBeenCalledWith({
      type: 'job-dispatch',
      correlationId: 'nhtsa-recalls:1',
      dispatchId: expect.any(String),
      queueName: 'nhtsa-recalls',
      payload: {},
    })
  })

  it('throws RetryJobSignal when no httpEnrich-capable worker is connected', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry, { capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 2 } })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    await expect(
      dispatcher.dispatch('nhtsa-recalls', '1', {}, { chromium: false, httpEnrich: true }),
    ).rejects.toThrow(RetryJobSignal)
  })

  it('acquires the per-source lock for an httpEnrich dispatch exactly as SOURCE_SCRAPE does', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry, {
      capabilities: { chromium: false, httpEnrich: true, maxConcurrentJobs: 2 },
    })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    void dispatcher.dispatch(
      'nhtsa-recalls',
      '1',
      {},
      { chromium: false, httpEnrich: true, sourceId: 'nhtsa-recalls-api' },
    )
    await expect(
      dispatcher.dispatch(
        'nhtsa-recalls',
        '2',
        {},
        { chromium: false, httpEnrich: true, sourceId: 'nhtsa-recalls-api' },
      ),
    ).rejects.toThrow(RetryJobSignal)
  })

  it('releases the per-source lock once an httpEnrich dispatch completes', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry, {
      capabilities: { chromium: false, httpEnrich: true, maxConcurrentJobs: 2 },
    })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const first = dispatcher.dispatch(
      'nhtsa-recalls',
      '1',
      {},
      { chromium: false, httpEnrich: true, sourceId: 'nhtsa-recalls-api' },
    )
    await Promise.resolve()
    dispatcher.complete('nhtsa-recalls:1', dispatchIdFrom(worker), true, undefined, {
      processed: 3,
    })
    await expect(first).resolves.toEqual({ processed: 3 })
    expect(registry.tryAcquireSourceLock('nhtsa-recalls-api', 'nhtsa-recalls:2')).toBe(true)
  })
})

describe('WorkerDispatcher timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a dispatch that never receives a completion callback', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 5000)
    const assertion = expect(
      dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true }),
    ).rejects.toThrow('did not report completion')
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })

  it('releases the worker inFlight slot after a timeout', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 5000)
    const settled = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true }).catch(() => {})
    await vi.advanceTimersByTimeAsync(5000)
    await settled
    expect(worker.inFlight.size).toBe(0)
  })
})

describe('WorkerDispatcher capability escalation (#1043)', () => {
  const escalation = { capability: 'chromium' as const, reason: 'blocked over http' }

  it('rejects the pending dispatch with CapabilityEscalationError and frees the source lock', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry, {
      capabilities: { chromium: false, httpEnrich: false, maxConcurrentJobs: 2 },
    })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const pending = dispatcher.dispatch('source-scrape', '1', {}, { chromium: false, sourceId: 'blvd' })
    const assertion = expect(pending).rejects.toBeInstanceOf(CapabilityEscalationError)
    await Promise.resolve()

    const known = dispatcher.complete(
      'source-scrape:1', dispatchIdFrom(worker), false, 'x', undefined, escalation,
    )
    expect(known).toBe(true)
    await assertion
    await expect(pending).rejects.toMatchObject({ escalation })
    expect(worker.inFlight.size).toBe(0)
    // Lock released: the source can be dispatched again immediately.
    expect(registry.tryAcquireSourceLock('blvd', 'other')).toBe(true)
  })

  it('is not a RetryJobSignal and not a plain failure', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const pending = dispatcher.dispatch('source-scrape', '1', {}, { chromium: false })
    const caught = pending.catch((e: unknown) => e)
    await Promise.resolve()
    dispatcher.complete('source-scrape:1', dispatchIdFrom(worker), false, undefined, undefined, escalation)
    const err = await caught
    expect(err).not.toBeInstanceOf(RetryJobSignal)
    expect((err as Error).name).toBe('CapabilityEscalationError')
  })

  it('ignores an escalation from a stale dispatchId (superseded attempt)', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const pending = dispatcher.dispatch('source-scrape', '1', {}, { chromium: false })
    await Promise.resolve()
    const known = dispatcher.complete(
      'source-scrape:1', 'stale-dispatch-id', false, undefined, undefined, escalation,
    )
    expect(known).toBe(false)
    // Current attempt unaffected and still completable.
    dispatcher.complete('source-scrape:1', dispatchIdFrom(worker), true)
    await expect(pending).resolves.toBeUndefined()
  })

  it('rejects an escalation reported after the worker disconnected', async () => {
    const registry = new WorkerRegistry()
    const worker = connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const pending = dispatcher.dispatch('source-scrape', '1', {}, { chromium: false })
    const caught = pending.catch((e: unknown) => e)
    await Promise.resolve()
    const dispatchId = dispatchIdFrom(worker)
    registry.unregister('conn-1')
    dispatcher.failConnection('conn-1', 'worker disconnected')
    expect(await caught).toBeInstanceOf(RetryJobSignal)

    expect(
      dispatcher.complete('source-scrape:1', dispatchId, false, undefined, undefined, escalation),
    ).toBe(false)
  })
})
