import { randomUUID } from 'node:crypto'
import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { workerToCoordinatorMessageSchema, workerJobCompleteRequestSchema } from '@wivwav/types/worker-protocol'
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
 * WS dispatch endpoint + completion callback for remote workers (#948).
 * Mount inside a scope already guarded by adminAuthPlugin (the auth hook
 * runs on the WS upgrade request too, so a missing/wrong bearer token is
 * rejected before the socket ever opens — same fail-closed semantics as
 * every other /internal surface).
 *
 * Routes (relative to the mount prefix, normally /internal/workers):
 * - GET  /ws              WS upgrade; first message must be a WorkerHello.
 * - POST /jobs/complete   Worker's final job outcome; settles the dispatch.
 */
export async function workerGatewayRoutes(
  app: FastifyInstance,
  { registry, dispatcher, logger }: WorkerGatewayPluginOptions,
): Promise<void> {
  await app.register(websocket)

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

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let parsedJson: unknown
      try {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        parsedJson = JSON.parse(raw.toString())
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
    const known = dispatcher.complete(body.correlationId, body.success, body.errorMessage)
    return reply.send({ data: { acknowledged: known } })
  })
}
