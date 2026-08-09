import Fastify from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { describe, expect, it, vi } from 'vitest'
import { adminAuthPlugin } from './admin-auth.js'
import { workerGatewayRoutes } from './worker-gateway-ws.js'
import { WorkerRegistry } from '../worker-gateway/registry.js'
import { WorkerDispatcher } from '../worker-gateway/dispatcher.js'

const INTERNAL_API_SECRET = 'a'.repeat(32)

/**
 * `@fastify/websocket` is `fastify-plugin`-wrapped (no new encapsulation
 * context), so its decorators land on whatever instance `.register()`s it —
 * registering directly on the root `app` (rather than the nested
 * auth-guarded scope, which is where app.ts registers it) is what makes
 * `app.injectWS` available to these tests. `onRoute` hooks it adds still
 * apply tree-wide, so the `/ws` route defined deep inside
 * `workerGatewayRoutes` is detected correctly either way — see
 * worker-gateway-ws.ts's docstring for why that plugin itself never
 * registers `@fastify/websocket`.
 */
function buildTestApp(secret: string | undefined, nodeEnv: 'development' | 'test' | 'production' = 'test') {
  const app = Fastify()
  const registry = new WorkerRegistry()
  const dispatcher = new WorkerDispatcher(registry, 60_000)

  return {
    app,
    registry,
    dispatcher,
    ready: app.register(websocketPlugin).register(async (scope) => {
      await adminAuthPlugin(scope, { internalApiSecret: secret, nodeEnv })
      await scope.register(workerGatewayRoutes, { registry, dispatcher })
    }),
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('worker gateway WS auth', () => {
  it('rejects an upgrade with no Authorization header (401)', async () => {
    const { app, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready
    await app.ready()

    await expect(app.injectWS('/ws')).rejects.toThrow('401')
    await app.close()
  })

  it('rejects an upgrade with the wrong bearer token (401)', async () => {
    const { app, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready
    await app.ready()

    await expect(
      app.injectWS('/ws', { headers: { authorization: 'Bearer wrong-secret' } }),
    ).rejects.toThrow('401')
    await app.close()
  })

  it('accepts an upgrade with the correct bearer token', async () => {
    const { app, registry, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready
    await app.ready()

    const ws = await app.injectWS('/ws', { headers: { authorization: `Bearer ${INTERNAL_API_SECRET}` } })
    ws.send(
      JSON.stringify({
        type: 'hello',
        workerId: 'w-1',
        workerName: 'laptop',
        capabilities: { chromium: true, maxConcurrentJobs: 2 },
      }),
    )
    await waitFor(() => registry.list().length === 1)
    expect(registry.list()[0]?.workerId).toBe('w-1')
    ws.close()
    await app.close()
  })

  it('fails closed (503) in production when no secret is configured', async () => {
    const { app, ready } = buildTestApp(undefined, 'production')
    await ready
    await app.ready()

    await expect(app.injectWS('/ws')).rejects.toThrow('503')
    await app.close()
  })
})

describe('worker gateway WS protocol', () => {
  it('registers the worker with its declared capabilities on hello', async () => {
    const { app, registry, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready
    await app.ready()

    const ws = await app.injectWS('/ws', { headers: { authorization: `Bearer ${INTERNAL_API_SECRET}` } })
    ws.send(
      JSON.stringify({
        type: 'hello',
        workerId: 'w-1',
        workerName: 'laptop',
        capabilities: { chromium: true, maxConcurrentJobs: 3 },
      }),
    )
    await waitFor(() => registry.list().length === 1)
    expect(registry.list()[0]?.capabilities).toEqual({ chromium: true, maxConcurrentJobs: 3 })
    ws.close()
    await app.close()
  })

  it('unregisters the worker when the socket closes', async () => {
    const { app, registry, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready
    await app.ready()

    const ws = await app.injectWS('/ws', { headers: { authorization: `Bearer ${INTERNAL_API_SECRET}` } })
    ws.send(
      JSON.stringify({
        type: 'hello',
        workerId: 'w-1',
        workerName: 'laptop',
        capabilities: { chromium: true, maxConcurrentJobs: 2 },
      }),
    )
    await waitFor(() => registry.list().length === 1)
    ws.terminate()
    await waitFor(() => registry.list().length === 0)
    await app.close()
  })

  it('closes the connection on an invalid first message (not a valid hello)', async () => {
    const { app, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready
    await app.ready()

    const ws = await app.injectWS('/ws', { headers: { authorization: `Bearer ${INTERNAL_API_SECRET}` } })
    const closed = new Promise<number>((resolve) => ws.on('close', (code: number) => resolve(code)))
    ws.send(JSON.stringify({ type: 'heartbeat', sentAt: new Date().toISOString() }))
    const code = await closed
    expect(code).toBe(1008)
    await app.close()
  })

  it("calls the dispatcher's refuse() when a worker sends a refusal ack", async () => {
    const { app, dispatcher, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready
    await app.ready()
    const refuseSpy = vi.spyOn(dispatcher, 'refuse')

    const ws = await app.injectWS('/ws', { headers: { authorization: `Bearer ${INTERNAL_API_SECRET}` } })
    ws.send(
      JSON.stringify({
        type: 'hello',
        workerId: 'w-1',
        workerName: 'laptop',
        capabilities: { chromium: true, maxConcurrentJobs: 2 },
      }),
    )
    ws.send(JSON.stringify({ type: 'job-ack', correlationId: 'q:1', accepted: false, reason: 'busy' }))
    await waitFor(() => refuseSpy.mock.calls.length === 1)
    expect(refuseSpy).toHaveBeenCalledWith('q:1', 'busy')
    ws.close()
    await app.close()
  })
})

describe('POST /jobs/complete', () => {
  it("settles the dispatcher's pending promise for a successful completion", async () => {
    const { app, dispatcher, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready
    const completeSpy = vi.spyOn(dispatcher, 'complete')

    const response = await app.inject({
      method: 'POST',
      url: '/jobs/complete',
      headers: { authorization: `Bearer ${INTERNAL_API_SECRET}`, 'content-type': 'application/json' },
      payload: { correlationId: 'q:1', success: true },
    })

    expect(response.statusCode).toBe(200)
    expect(completeSpy).toHaveBeenCalledWith('q:1', true, undefined)
    await app.close()
  })

  it('reports acknowledged: false for an unknown correlation id', async () => {
    const { app, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready

    const response = await app.inject({
      method: 'POST',
      url: '/jobs/complete',
      headers: { authorization: `Bearer ${INTERNAL_API_SECRET}`, 'content-type': 'application/json' },
      payload: { correlationId: 'unknown:1', success: true },
    })

    expect(response.json()).toEqual({ data: { acknowledged: false } })
    await app.close()
  })

  it('rejects a request without the bearer token (401)', async () => {
    const { app, ready } = buildTestApp(INTERNAL_API_SECRET)
    await ready

    const response = await app.inject({
      method: 'POST',
      url: '/jobs/complete',
      payload: { correlationId: 'q:1', success: true },
    })

    expect(response.statusCode).toBe(401)
    await app.close()
  })
})
