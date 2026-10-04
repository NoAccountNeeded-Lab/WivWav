import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import { WsClient, type WsClientOptions } from './ws-client.js'
import { HandlerRegistry } from './handler-registry.js'
import { EscalateCapabilitySignal } from '@wivwav/scraper-sources'

class FakeSocket extends EventEmitter {
  static instances: FakeSocket[] = []
  readyState = 1 // WebSocket.OPEN
  sent: unknown[] = []
  closed = false

  constructor(public url: string, public opts: { headers: Record<string, string> }) {
    super()
    FakeSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }

  close(): void {
    this.closed = true
    this.emit('close', 1000, Buffer.from(''))
  }

  openNow(): void {
    this.emit('open')
  }

  receive(message: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(message)))
  }
}

function buildClient(overrides: Partial<WsClientOptions> = {}) {
  FakeSocket.instances = []
  const handlers = new HandlerRegistry()
  const gateway = { completeJob: vi.fn(async () => ({ acknowledged: true })) }
  const client = new WsClient({
    coordinatorUrl: 'http://api:3001',
    token: 'secret',
    workerId: 'w-1',
    workerName: 'test-worker',
    capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 2 },
    handlers,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gateway: gateway as any,
    logger: createNoopLogger(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    WebSocketImpl: FakeSocket as any,
    ...overrides,
  })
  return { client, handlers, gateway }
}

describe('WsClient', () => {
  it('sends a WorkerHello on open', () => {
    const { client } = buildClient()
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()
    expect(socket.sent).toContainEqual({
      type: 'hello',
      workerId: 'w-1',
      workerName: 'test-worker',
      capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 2 },
    })
    client.stop()
  })

  it('acks a dispatch, runs the handler, and reports success over HTTP', async () => {
    const { client, handlers, gateway } = buildClient()
    let resolveHandler!: () => void
    handlers.register(
      'source-scrape',
      () =>
        new Promise((resolve) => {
          resolveHandler = () => resolve({ listingsChanged: true })
        }),
    )
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()
    socket.sent.length = 0

    socket.receive({
      type: 'job-dispatch',
      correlationId: 'c1',
      dispatchId: 'd1',
      queueName: 'source-scrape',
      payload: { sourceId: 's1' },
    })
    expect(socket.sent).toContainEqual({
      type: 'job-ack',
      correlationId: 'c1',
      dispatchId: 'd1',
      accepted: true,
    })

    resolveHandler()
    await new Promise((r) => setTimeout(r, 0))
    expect(gateway.completeJob).toHaveBeenCalledWith({
      correlationId: 'c1',
      dispatchId: 'd1',
      success: true,
      result: { listingsChanged: true },
    })
    client.stop()
  })

  it('reports failure over HTTP when the handler throws', async () => {
    const { client, handlers, gateway } = buildClient()
    handlers.register('detail-crawl', async () => {
      throw new Error('boom')
    })
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()

    socket.receive({
      type: 'job-dispatch',
      correlationId: 'c2',
      dispatchId: 'd2',
      queueName: 'detail-crawl',
      payload: { sourceId: 's1' },
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(gateway.completeJob).toHaveBeenCalledWith({
      correlationId: 'c2',
      dispatchId: 'd2',
      success: false,
      errorMessage: 'boom',
    })
    client.stop()
  })

  it('reports a capability escalation (not a failure) when the handler throws EscalateCapabilitySignal', async () => {
    const { client, handlers, gateway } = buildClient()
    handlers.register('source-scrape', async () => {
      throw new EscalateCapabilitySignal('chromium', 'blocked over http')
    })
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()

    socket.receive({
      type: 'job-dispatch',
      correlationId: 'source-scrape:7',
      dispatchId: 'd7',
      queueName: 'source-scrape',
      payload: { sourceId: 's1' },
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(gateway.completeJob).toHaveBeenCalledTimes(1)
    expect(gateway.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'source-scrape:7',
        dispatchId: 'd7',
        success: false,
        escalation: { capability: 'chromium', reason: 'blocked over http' },
      }),
    )
    client.stop()
  })

  it('substitutes a non-empty reason when the escalation signal carries an empty one', async () => {
    const { client, handlers, gateway } = buildClient()
    handlers.register('source-scrape', async () => {
      throw new EscalateCapabilitySignal('chromium', '')
    })
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()
    socket.receive({
      type: 'job-dispatch',
      correlationId: 'source-scrape:8',
      dispatchId: 'd8',
      queueName: 'source-scrape',
      payload: { sourceId: 's1' },
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(gateway.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({ escalation: { capability: 'chromium', reason: 'unspecified' } }),
    )
    client.stop()
  })

  it('logs job.complete-report-failed and keeps running when the escalation report itself rejects', async () => {
    const logger = createNoopLogger()
    const errorSpy = vi.spyOn(logger, 'error')
    const { client, handlers, gateway } = buildClient({ logger })
    gateway.completeJob.mockRejectedValueOnce(new Error('coordinator unreachable'))
    handlers.register('source-scrape', async () => {
      throw new EscalateCapabilitySignal('chromium', 'blocked over http')
    })
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()
    socket.receive({
      type: 'job-dispatch',
      correlationId: 'source-scrape:9',
      dispatchId: 'd9',
      queueName: 'source-scrape',
      payload: { sourceId: 's1' },
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job.complete-report-failed', correlationId: 'source-scrape:9' }),
      expect.any(String),
    )
    expect(gateway.completeJob).toHaveBeenCalledTimes(1)
    client.stop()
  })

  it('refuses a dispatch for an unknown queue', () => {
    const { client } = buildClient()
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()
    socket.sent.length = 0

    socket.receive({
      type: 'job-dispatch',
      correlationId: 'c3',
      dispatchId: 'd3',
      queueName: 'nope',
      payload: {},
    })
    expect(socket.sent).toHaveLength(1)
    const ack = socket.sent[0] as { type: string; accepted: boolean; reason: string }
    expect(ack.type).toBe('job-ack')
    expect(ack.accepted).toBe(false)
    expect(ack.reason).toMatch(/no handler/)
    client.stop()
  })

  it('refuses a dispatch when already at capacity', () => {
    const { client, handlers } = buildClient({ capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 1 } })
    handlers.register('source-scrape', () => new Promise(() => {})) // never resolves
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()

    socket.receive({
      type: 'job-dispatch',
      correlationId: 'c4',
      dispatchId: 'd4',
      queueName: 'source-scrape',
      payload: {},
    })
    socket.sent.length = 0
    socket.receive({
      type: 'job-dispatch',
      correlationId: 'c5',
      dispatchId: 'd5',
      queueName: 'source-scrape',
      payload: {},
    })

    const ack = socket.sent[0] as { type: string; accepted: boolean; reason: string }
    expect(ack.accepted).toBe(false)
    expect(ack.reason).toMatch(/at capacity/)
    client.stop()
  })

  it('refuses any new dispatch once draining, without starting the handler', async () => {
    const { client, handlers } = buildClient()
    const handler = vi.fn(() => new Promise(() => {}))
    handlers.register('source-scrape', handler)
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()

    const drained = client.drain(1000)
    socket.sent.length = 0
    socket.receive({
      type: 'job-dispatch',
      correlationId: 'c6',
      dispatchId: 'd6',
      queueName: 'source-scrape',
      payload: {},
    })

    const ack = socket.sent[0] as { type: string; accepted: boolean; reason: string }
    expect(ack.accepted).toBe(false)
    expect(ack.reason).toMatch(/draining/)
    expect(handler).not.toHaveBeenCalled()
    await drained
    client.stop()
  })

  it('drain() resolves once in-flight jobs finish, before the grace period elapses', async () => {
    vi.useFakeTimers()
    const { client, handlers } = buildClient()
    let resolveHandler!: () => void
    handlers.register(
      'source-scrape',
      () =>
        new Promise((resolve) => {
          resolveHandler = () => resolve({ listingsChanged: false })
        }),
    )
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()
    socket.receive({
      type: 'job-dispatch',
      correlationId: 'c7',
      dispatchId: 'd7',
      queueName: 'source-scrape',
      payload: {},
    })

    let drainedResolved = false
    const drained = client.drain(30_000).then(() => {
      drainedResolved = true
    })
    await Promise.resolve()
    expect(drainedResolved).toBe(false)

    resolveHandler()
    await vi.advanceTimersByTimeAsync(0)
    await drained
    expect(drainedResolved).toBe(true)
    client.stop()
    vi.useRealTimers()
  })

  it('drain() resolves anyway once the grace period elapses with jobs still in flight', async () => {
    vi.useFakeTimers()
    const { client, handlers } = buildClient()
    handlers.register('source-scrape', () => new Promise(() => {}))
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()
    socket.receive({
      type: 'job-dispatch',
      correlationId: 'c8',
      dispatchId: 'd8',
      queueName: 'source-scrape',
      payload: {},
    })

    const drained = client.drain(5000)
    await vi.advanceTimersByTimeAsync(5000)
    await drained
    client.stop()
    vi.useRealTimers()
  })

  it('reconnects and re-sends hello after a disconnect', () => {
    vi.useFakeTimers()
    const { client } = buildClient()
    client.start()
    const first = FakeSocket.instances[0]!
    first.openNow()

    first.close()
    vi.advanceTimersByTime(30_000)

    expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(2)
    const second = FakeSocket.instances[1]!
    second.openNow()
    expect(second.sent).toContainEqual(
      expect.objectContaining({ type: 'hello', workerId: 'w-1' }),
    )
    client.stop()
    vi.useRealTimers()
  })
})
