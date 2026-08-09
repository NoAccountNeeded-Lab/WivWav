import { RetryJobSignal } from '@wivwav/queue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkerDispatcher, NO_WORKER_RETRY_DELAY_MS } from './dispatcher.js'
import { WorkerRegistry, type RegisteredWorker } from './registry.js'

function connectWorker(
  registry: WorkerRegistry,
  overrides: Partial<RegisteredWorker> = {},
): RegisteredWorker {
  const worker: RegisteredWorker = {
    connectionId: 'conn-1',
    workerId: 'worker-1',
    workerName: 'laptop',
    capabilities: { chromium: true, maxConcurrentJobs: 2 },
    inFlight: new Set(),
    lastHeartbeatAt: new Date(),
    send: vi.fn(),
    ...overrides,
  }
  registry.register(worker)
  return worker
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

  it('sends a job-dispatch message to the picked worker', async () => {
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
    connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    dispatcher.complete('detail-crawl:1', true)
    await expect(promise).resolves.toBeUndefined()
  })

  it('resolves with the worker-reported result', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('source-scrape', '1', {}, { chromium: true })
    dispatcher.complete('source-scrape:1', true, undefined, { listingsChanged: true })
    await expect(promise).resolves.toEqual({ listingsChanged: true })
  })

  it('rejects when complete(success: false) is called', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    dispatcher.complete('detail-crawl:1', false, 'browser crashed')
    await expect(promise).rejects.toThrow('browser crashed')
  })

  it('complete() returns false for an unknown correlation id', () => {
    const registry = new WorkerRegistry()
    const dispatcher = new WorkerDispatcher(registry, 1000)
    expect(dispatcher.complete('unknown:1', true)).toBe(false)
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
    connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const first = dispatcher.dispatch(
      'detail-crawl',
      '1',
      {},
      { chromium: true, sourceId: 'src-1' },
    )
    dispatcher.complete('detail-crawl:1', true)
    await first
    expect(registry.tryAcquireSourceLock('src-1', 'detail-crawl:2')).toBe(true)
  })

  it('refuse() rejects the pending dispatch with RetryJobSignal and the worker-supplied reason', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry)
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const promise = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    dispatcher.refuse('detail-crawl:1', 'at capacity')
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
    connectWorker(registry, { connectionId: 'conn-2' })
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
    dispatcher.failConnection('conn-1', 'worker disconnected')
    dispatcher.complete('detail-crawl:2', true)
    const settled = await Promise.allSettled([first, second])
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'fulfilled'])
  })

  it('a stale pending dispatch is superseded by a re-dispatch of the same correlation id', async () => {
    const registry = new WorkerRegistry()
    connectWorker(registry, { capabilities: { chromium: true, maxConcurrentJobs: 5 } })
    const dispatcher = new WorkerDispatcher(registry, 1000)
    const stale = dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    void dispatcher.dispatch('detail-crawl', '1', {}, { chromium: true })
    await expect(stale).rejects.toThrow('superseded')
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
