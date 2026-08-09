import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import {
  workerToCoordinatorMessageSchema,
  workerJobCompleteRequestSchema,
} from '@wivwav/types/worker-protocol'
import type { CoordinatorToWorkerMessage } from '@wivwav/types/worker-protocol'
import type { WivWavLogger } from '@wivwav/logger'
import type { WorkerRegistry } from '../worker-gateway/registry.js'
import type { WorkerDispatcher } from '../worker-gateway/dispatcher.js'

export interface WorkerGatewayPluginOptions {
  registry: WorkerRegistry
  dispatcher: WorkerDispatcher
  logger?: WivWavLogger
}

/**
 * Decodes a `ws` message event's raw payload to UTF-8 text. `Buffer.toString()`
 * does this correctly on its own, but the other two shapes the `message`
 * event's type admits do not: a bare `ArrayBuffer.toString()` yields the
 * literal string `'[object ArrayBuffer]'`, and `Buffer[].toString()` joins
 * each buffer's own decoded text with a comma — both would corrupt or
 * outright fail to parse a legitimate JSON message.
 */
function decodeWsMessage(raw: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  return Buffer.from(raw).toString('utf8')
}

/**
 * How often the coordinator pings each connected worker to detect a dead
 * socket that never fires a WS 'close' event — e.g. a sleeping laptop or a
 * NAT timeout that drops the connection without a TCP FIN/RST. Independent
 * of the application-level `heartbeat` protocol message (which only detects
 * liveness if a worker actually sends one): this uses the WS protocol's own
 * ping/pong, which every compliant client answers automatically with no
 * worker-side application code required.
 */
const PING_INTERVAL_MS = 30_000

/**
 * WS dispatch endpoint + completion callback for remote workers (#948).
 * Mount inside a scope already guarded by adminAuthPlugin (the auth hook
 * runs on the WS upgrade request too, so a missing/wrong bearer token is
 * rejected before the socket ever opens — same fail-closed semantics as
 * every other /internal surface) AND already registered with
 * `@fastify/websocket` — this plugin does not register it itself. Doing so
 * would work at runtime (app.ts's single registration site), but
 * `@fastify/websocket` skips its own encapsulation (`fastify-plugin`),
 * decorating whatever instance is actually handed to `.register()`; a
 * caller (e.g. a test) that already registered it at a higher level would
 * hit Fastify's "decorator already added" error on a second registration
 * one level down. Requiring the caller to register it keeps this plugin
 * composable without hidden double-registration hazards.
 *
 * Routes (relative to the mount prefix, normally /internal/workers):
 * - GET  /ws              WS upgrade; first message must be a WorkerHello.
 * - POST /jobs/complete   Worker's final job outcome; settles the dispatch.
 */
export async function workerGatewayRoutes(
  app: FastifyInstance,
  { registry, dispatcher, logger }: WorkerGatewayPluginOptions,
): Promise<void> {
  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const connectionId = randomUUID()
    let registered = false

    const close = (code: number, reason: string): void => {
      try {
        socket.close(code, reason)
      } catch {
        socket.terminate()
      }
    }

    let awaitingPong = false
    const pingInterval = setInterval(() => {
      if (awaitingPong) {
        logger?.warn(
          { connectionId },
          '[worker-gateway] no pong received; terminating dead connection',
        )
        socket.terminate()
        return
      }
      awaitingPong = true
      socket.ping()
    }, PING_INTERVAL_MS)
    pingInterval.unref()
    socket.on('pong', () => {
      awaitingPong = false
    })

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(decodeWsMessage(raw))
      } catch {
        logger?.warn({ connectionId }, '[worker-gateway] non-JSON WS message; closing')
        close(1003, 'messages must be JSON')
        return
      }

      const result = workerToCoordinatorMessageSchema.safeParse(parsedJson)
      if (!result.success) {
        logger?.warn(
          { connectionId, issues: result.error.issues.map((i) => i.path.join('.')) },
          '[worker-gateway] invalid WS message; closing',
        )
        close(1008, 'invalid message')
        return
      }

      const message = result.data
      if (message.type === 'hello') {
        if (registered) return
        registered = true
        registry.register({
          connectionId,
          workerId: message.workerId,
          workerName: message.workerName,
          capabilities: message.capabilities,
          inFlight: new Set(),
          lastHeartbeatAt: new Date(),
          send: (outbound: CoordinatorToWorkerMessage) => {
            socket.send(JSON.stringify(outbound))
          },
        })
        logger?.info(
          {
            connectionId,
            workerId: message.workerId,
            workerName: message.workerName,
            capabilities: message.capabilities,
          },
          '[worker-gateway] worker connected',
        )
        return
      }

      if (!registered) {
        close(1008, 'hello required before other messages')
        return
      }

      if (message.type === 'heartbeat') {
        registry.recordHeartbeat(connectionId, message.sentAt)
        return
      }

      // job-ack
      if (!message.accepted) {
        dispatcher.refuse(message.correlationId, message.reason ?? 'unspecified')
      }
    })

    socket.on('close', () => {
      clearInterval(pingInterval)
      const worker = registry.unregister(connectionId)
      if (worker) {
        logger?.info(
          { connectionId, workerId: worker.workerId, workerName: worker.workerName },
          '[worker-gateway] worker disconnected',
        )
      }
      dispatcher.failConnection(connectionId, 'worker disconnected before reporting completion')
    })

    socket.on('error', (err: Error) => {
      logger?.warn({ connectionId, err }, '[worker-gateway] WS error')
    })

    req.log.info({ connectionId }, '[worker-gateway] WS connection opened; awaiting hello')
  })

  app.post('/jobs/complete', async (req, reply) => {
    const body = workerJobCompleteRequestSchema.parse(req.body)
    const known = dispatcher.complete(
      body.correlationId,
      body.success,
      body.errorMessage,
      body.result,
    )
    return reply.send({ data: { acknowledged: known } })
  })
}
