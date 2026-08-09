import { z } from 'zod'
import { isoDateTimeSchema } from './wire-date.js'

/**
 * WebSocket protocol envelope between the job coordinator (`apps/api`) and
 * remote workers (#948). Workers dial an outbound WS to the coordinator,
 * introduce themselves with a hello declaring their capabilities, and then
 * receive job dispatches. All job *results* travel over authenticated HTTP
 * (see scraper-gateway.ts), never over this socket — the WS carries only
 * small control messages.
 */

export const workerCapabilitiesSchema = z.object({
  /** Whether this worker can run Playwright/Chromium jobs. */
  chromium: z.boolean(),
  /** Upper bound of jobs the coordinator may have in flight on this worker. */
  maxConcurrentJobs: z.number().int().positive(),
})
export type WorkerCapabilities = z.infer<typeof workerCapabilitiesSchema>

/** First message a worker sends after the WS upgrade succeeds. */
export const workerHelloSchema = z.object({
  type: z.literal('hello'),
  /** Stable identifier for this worker instance (survives reconnects). */
  workerId: z.string().min(1),
  /** Human-readable name for logs and the ops UI. */
  workerName: z.string().min(1),
  capabilities: workerCapabilitiesSchema,
})
export type WorkerHello = z.infer<typeof workerHelloSchema>

/**
 * Coordinator → worker: run this job. `correlationId` must be echoed back in
 * the ack and in every HTTP result submission so the coordinator can settle
 * the originating queue job.
 */
export const wsJobDispatchMessageSchema = z.object({
  type: z.literal('job-dispatch'),
  correlationId: z.string().min(1),
  queueName: z.string().min(1),
  /** Queue-specific job payload; absent for jobs enqueued without one. */
  payload: z.unknown().optional(),
})
export type WsJobDispatchMessage = z.infer<typeof wsJobDispatchMessageSchema>

/** Worker → coordinator: dispatch received, or refused — then `reason` is required. */
export const wsJobAckMessageSchema = z
  .object({
    type: z.literal('job-ack'),
    correlationId: z.string().min(1),
    accepted: z.boolean(),
    reason: z.string().optional(),
  })
  .superRefine((message, ctx) => {
    if (!message.accepted && (message.reason === undefined || message.reason.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'reason is required when a dispatch is refused',
      })
    }
  })
export type WsJobAckMessage = z.infer<typeof wsJobAckMessageSchema>

/** Liveness signal, sent in both directions. */
export const wsHeartbeatMessageSchema = z.object({
  type: z.literal('heartbeat'),
  sentAt: isoDateTimeSchema,
})
export type WsHeartbeatMessage = z.infer<typeof wsHeartbeatMessageSchema>

export const workerToCoordinatorMessageSchema = z.discriminatedUnion('type', [
  workerHelloSchema,
  wsJobAckMessageSchema,
  wsHeartbeatMessageSchema,
])
export type WorkerToCoordinatorMessage = z.infer<typeof workerToCoordinatorMessageSchema>

export const coordinatorToWorkerMessageSchema = z.discriminatedUnion('type', [
  wsJobDispatchMessageSchema,
  wsHeartbeatMessageSchema,
])
export type CoordinatorToWorkerMessage = z.infer<typeof coordinatorToWorkerMessageSchema>

/**
 * Canonical correlation-id format: one queue job maps to exactly one dispatch,
 * and the coordinator resolves its in-memory promise by this key when the
 * worker's final HTTP result submission lands.
 */
export function buildCorrelationId(queueName: string, jobId: string): string {
  return `${queueName}:${jobId}`
}
