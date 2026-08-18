import { describe, expect, it, vi } from 'vitest'
import { WorkerRegistry, type RegisteredWorker } from './registry.js'

function makeWorker(overrides: Partial<RegisteredWorker> = {}): RegisteredWorker {
  return {
    connectionId: 'conn-1',
    workerId: 'worker-1',
    workerName: 'laptop',
    capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 2 },
    inFlight: new Set(),
    lastHeartbeatAt: new Date(),
    send: vi.fn(),
    ...overrides,
  }
}

describe('WorkerRegistry.pickWorker', () => {
  it('returns undefined when no worker is registered', () => {
    const registry = new WorkerRegistry()
    expect(registry.pickWorker({ chromium: true })).toBeUndefined()
  })

  it('skips a worker lacking the required chromium capability', () => {
    const registry = new WorkerRegistry()
    registry.register(
      makeWorker({ capabilities: { chromium: false, httpEnrich: false, maxConcurrentJobs: 2 } }),
    )
    expect(registry.pickWorker({ chromium: true })).toBeUndefined()
  })

  it('skips a worker at its concurrency cap', () => {
    const registry = new WorkerRegistry()
    registry.register(
      makeWorker({
        capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 1 },
        inFlight: new Set(['q:1']),
      }),
    )
    expect(registry.pickWorker({ chromium: true })).toBeUndefined()
  })

  it('picks the least-loaded eligible worker', () => {
    const registry = new WorkerRegistry()
    const busy = makeWorker({ connectionId: 'busy', inFlight: new Set(['q:1']) })
    const idle = makeWorker({ connectionId: 'idle' })
    registry.register(busy)
    registry.register(idle)
    expect(registry.pickWorker({ chromium: true })?.connectionId).toBe('idle')
  })
})

describe('WorkerRegistry.pickWorker httpEnrich capability (#962)', () => {
  it('returns undefined when no worker advertises httpEnrich', () => {
    const registry = new WorkerRegistry()
    registry.register(makeWorker({ capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 2 } }))
    expect(registry.pickWorker({ chromium: false, httpEnrich: true })).toBeUndefined()
  })

  it('picks a non-chromium worker that advertises httpEnrich', () => {
    const registry = new WorkerRegistry()
    const worker = makeWorker({
      capabilities: { chromium: false, httpEnrich: true, maxConcurrentJobs: 2 },
    })
    registry.register(worker)
    expect(registry.pickWorker({ chromium: false, httpEnrich: true })?.connectionId).toBe(
      worker.connectionId,
    )
  })

  it('selects httpEnrich independently of chromium with mixed-capability workers', () => {
    const registry = new WorkerRegistry()
    const chromiumOnly = makeWorker({
      connectionId: 'chromium-only',
      capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 2 },
    })
    const httpEnrichOnly = makeWorker({
      connectionId: 'http-enrich-only',
      capabilities: { chromium: false, httpEnrich: true, maxConcurrentJobs: 2 },
    })
    const both = makeWorker({
      connectionId: 'both',
      capabilities: { chromium: true, httpEnrich: true, maxConcurrentJobs: 2 },
    })
    registry.register(chromiumOnly)
    registry.register(httpEnrichOnly)
    registry.register(both)

    // Chromium-only requirement excludes the httpEnrich-only worker.
    expect(registry.pickWorker({ chromium: true, httpEnrich: false })?.connectionId).not.toBe(
      'http-enrich-only',
    )

    // httpEnrich requirement excludes the chromium-only worker.
    expect(registry.pickWorker({ chromium: false, httpEnrich: true })?.connectionId).not.toBe(
      'chromium-only',
    )
  })

  it('an omitted httpEnrich requirement behaves as no requirement (backward compatible)', () => {
    const registry = new WorkerRegistry()
    const worker = makeWorker({
      capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 2 },
    })
    registry.register(worker)
    expect(registry.pickWorker({ chromium: true })?.connectionId).toBe(worker.connectionId)
  })
})

describe('WorkerRegistry source lock', () => {
  it('acquires an unheld lock', () => {
    const registry = new WorkerRegistry()
    expect(registry.tryAcquireSourceLock('src-1', 'q:1')).toBe(true)
  })

  it('refuses a lock held by a different correlation id', () => {
    const registry = new WorkerRegistry()
    registry.tryAcquireSourceLock('src-1', 'q:1')
    expect(registry.tryAcquireSourceLock('src-1', 'q:2')).toBe(false)
  })

  it('re-acquiring the same correlation id succeeds (idempotent)', () => {
    const registry = new WorkerRegistry()
    registry.tryAcquireSourceLock('src-1', 'q:1')
    expect(registry.tryAcquireSourceLock('src-1', 'q:1')).toBe(true)
  })

  it('releases the lock so a different correlation id can acquire it', () => {
    const registry = new WorkerRegistry()
    registry.tryAcquireSourceLock('src-1', 'q:1')
    registry.releaseSourceLock('src-1', 'q:1')
    expect(registry.tryAcquireSourceLock('src-1', 'q:2')).toBe(true)
  })

  it('does not release a lock held by a different correlation id', () => {
    const registry = new WorkerRegistry()
    registry.tryAcquireSourceLock('src-1', 'q:1')
    registry.releaseSourceLock('src-1', 'q:2')
    expect(registry.tryAcquireSourceLock('src-1', 'q:2')).toBe(false)
  })
})

describe('WorkerRegistry connection lifecycle', () => {
  it('unregister removes and returns the worker', () => {
    const registry = new WorkerRegistry()
    const worker = makeWorker()
    registry.register(worker)
    expect(registry.unregister('conn-1')).toBe(worker)
    expect(registry.get('conn-1')).toBeUndefined()
  })

  it('unregister on an unknown connection returns undefined', () => {
    const registry = new WorkerRegistry()
    expect(registry.unregister('unknown')).toBeUndefined()
  })

  it('recordHeartbeat updates lastHeartbeatAt on a known worker', () => {
    const registry = new WorkerRegistry()
    const worker = makeWorker({ lastHeartbeatAt: new Date(0) })
    registry.register(worker)
    const now = new Date()
    registry.recordHeartbeat('conn-1', now)
    expect(worker.lastHeartbeatAt).toBe(now)
  })

  it('recordHeartbeat on an unknown connection is a no-op', () => {
    const registry = new WorkerRegistry()
    expect(() => registry.recordHeartbeat('unknown', new Date())).not.toThrow()
  })

  it('list returns every registered worker', () => {
    const registry = new WorkerRegistry()
    registry.register(makeWorker({ connectionId: 'a' }))
    registry.register(makeWorker({ connectionId: 'b' }))
    expect(
      registry
        .list()
        .map((w) => w.connectionId)
        .sort(),
    ).toEqual(['a', 'b'])
  })
})
