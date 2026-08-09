import WebSocket from 'ws'
import {
  coordinatorToWorkerMessageSchema,
  type WorkerCapabilities,
  type WorkerToCoordinatorMessage,
} from '@wivwav/types/worker-protocol'
import type { WivWavLogger } from '@wivwav/logger'
import type { HandlerRegistry } from './handler-registry.js'
import type { ScraperGatewayClient } from './scraper-gateway-client.js'

export interface WsClientOptions {
  coordinatorUrl: string
  token: string
  workerId: string
  workerName: string
  capabilities: WorkerCapabilities
  handlers: HandlerRegistry
  gateway: ScraperGatewayClient
  logger: WivWavLogger
  /** Overridable for tests; defaults to the real `ws` constructor. */
  WebSocketImpl?: typeof WebSocket
}

const HEARTBEAT_INTERVAL_MS = 15_000
const MIN_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000

function toWsUrl(coordinatorUrl: string): string {
  return `${coordinatorUrl.replace(/^http/, 'ws')}/internal/workers/ws`
}

function jitteredBackoff(attempt: number): number {
  const base = Math.min(MAX_RECONNECT_DELAY_MS, MIN_RECONNECT_DELAY_MS * 2 ** attempt)
  return base / 2 + Math.random() * (base / 2)
}

/**
 * Outbound WS client dialing the coordinator's `/internal/workers/ws`
 * (#948/#951/#952): sends `WorkerHello` on connect, answers job dispatches
 * by running the matching handler and reporting the outcome over HTTP
 * (never over the socket — see worker-protocol.ts's docstring), reconnects
 * with jittered exponential backoff on any drop, and sends its own
 * liveness heartbeat on an interval independent of the coordinator's WS
 * ping/pong.
 */
export class WsClient {
  private socket: WebSocket | null = null
  private reconnectAttempt = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight = 0
  private stopped = false

  constructor(private readonly options: WsClientOptions) {}

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.socket?.close(1000, 'worker shutting down')
  }

  private connect(): void {
    const { coordinatorUrl, token, logger } = this.options
    const WebSocketImpl = this.options.WebSocketImpl ?? WebSocket
    const url = toWsUrl(coordinatorUrl)
    logger.info({ event: 'ws.connecting', url }, `[ws-client] connecting to ${url}`)

    const socket = new WebSocketImpl(url, { headers: { Authorization: `Bearer ${token}` } })
    this.socket = socket

    socket.on('open', () => {
      this.reconnectAttempt = 0
      logger.info({ event: 'ws.open' }, '[ws-client] connected; sending hello')
      this.send({
        type: 'hello',
        workerId: this.options.workerId,
        workerName: this.options.workerName,
        capabilities: this.options.capabilities,
      })
      this.startHeartbeat()
    })

    socket.on('message', (raw: Buffer) => {
      this.handleMessage(raw)
    })

    socket.on('close', (code: number, reason: Buffer) => {
      logger.warn(
        { event: 'ws.close', code, reason: reason.toString('utf8') },
        '[ws-client] connection closed',
      )
      this.stopHeartbeat()
      this.socket = null
      this.scheduleReconnect()
    })

    socket.on('error', (err: Error) => {
      logger.warn({ event: 'ws.error', err: err.message }, '[ws-client] connection error')
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = jitteredBackoff(this.reconnectAttempt)
    this.reconnectAttempt++
    this.options.logger.info(
      { event: 'ws.reconnect-scheduled', delayMs: Math.round(delay) },
      `[ws-client] reconnecting in ${Math.round(delay)}ms`,
    )
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat', sentAt: new Date() })
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private send(message: WorkerToCoordinatorMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }

  private handleMessage(raw: Buffer): void {
    const { logger } = this.options
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw.toString('utf8'))
    } catch {
      logger.warn({ event: 'ws.invalid-json' }, '[ws-client] non-JSON WS message; ignoring')
      return
    }

    const result = coordinatorToWorkerMessageSchema.safeParse(parsedJson)
    if (!result.success) {
      logger.warn(
        { event: 'ws.invalid-message', issues: result.error.issues.map((i) => i.path.join('.')) },
        '[ws-client] invalid WS message; ignoring',
      )
      return
    }

    const message = result.data
    if (message.type === 'heartbeat') return
    if (message.type === 'job-dispatch') {
      this.handleDispatch(message.correlationId, message.queueName, message.payload)
    }
  }

  private handleDispatch(correlationId: string, queueName: string, payload: unknown): void {
    const { logger, handlers, capabilities } = this.options

    if (this.inFlight >= capabilities.maxConcurrentJobs) {
      this.send({
        type: 'job-ack',
        correlationId,
        accepted: false,
        reason: `worker at capacity (${this.inFlight}/${capabilities.maxConcurrentJobs} in flight)`,
      })
      return
    }

    const handler = handlers.get(queueName)
    if (!handler) {
      this.send({
        type: 'job-ack',
        correlationId,
        accepted: false,
        reason: `no handler registered for queue '${queueName}'`,
      })
      return
    }

    this.send({ type: 'job-ack', correlationId, accepted: true })
    this.inFlight++
    logger.info({ event: 'job.dispatch', correlationId, queueName }, `[ws-client] running ${queueName}`)

    handler(payload, correlationId)
      .then((result) =>
        this.options.gateway.completeJob({ correlationId, success: true, result }),
      )
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err)
        logger.error(
          { event: 'job.failed', correlationId, queueName, err: errorMessage },
          `[ws-client] ${queueName} failed: ${errorMessage}`,
        )
        return this.options.gateway.completeJob({ correlationId, success: false, errorMessage })
      })
      .catch((completeErr: unknown) => {
        // The job outcome itself couldn't be reported (network down, worker
        // killed mid-report, etc). Nothing more this process can do — the
        // coordinator's own dispatch timeout or this connection's eventual
        // 'close' event (which fails every in-flight correlation id) is what
        // lets the queue job retry and land on another worker.
        logger.error(
          { event: 'job.complete-report-failed', correlationId, err: String(completeErr) },
          '[ws-client] failed to report job completion to coordinator',
        )
      })
      .finally(() => {
        this.inFlight--
      })
  }
}
