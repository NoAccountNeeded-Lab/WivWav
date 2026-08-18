import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import { WsClient, type WsClientOptions } from './ws-client.js'
import { HandlerRegistry } from './handler-registry.js'

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

    socket.receive({ type: 'job-dispatch', correlationId: 'c1', queueName: 'source-scrape', payload: { sourceId: 's1' } })
    expect(socket.sent).toContainEqual({ type: 'job-ack', correlationId: 'c1', accepted: true })

    resolveHandler()
    await new Promise((r) => setTimeout(r, 0))
    expect(gateway.completeJob).toHaveBeenCalledWith({
      correlationId: 'c1',
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

    socket.receive({ type: 'job-dispatch', correlationId: 'c2', queueName: 'detail-crawl', payload: { sourceId: 's1' } })
    await new Promise((r) => setTimeout(r, 0))
    expect(gateway.completeJob).toHaveBeenCalledWith({
      correlationId: 'c2',
      success: false,
      errorMessage: 'boom',
    })
    client.stop()
  })

  it('refuses a dispatch for an unknown queue', () => {
    const { client } = buildClient()
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.openNow()
    socket.sent.length = 0

    socket.receive({ type: 'job-dispatch', correlationId: 'c3', queueName: 'nope', payload: {} })
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

    socket.receive({ type: 'job-dispatch', correlationId: 'c4', queueName: 'source-scrape', payload: {} })
    socket.sent.length = 0
    socket.receive({ type: 'job-dispatch', correlationId: 'c5', queueName: 'source-scrape', payload: {} })

    const ack = socket.sent[0] as { type: string; accepted: boolean; reason: string }
    expect(ack.accepted).toBe(false)
    expect(ack.reason).toMatch(/at capacity/)
    client.stop()
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
