/**
 * Thrown by a processor to put its job back in the waiting state WITHOUT
 * consuming a retry attempt (#948 worker gateway: "no remote worker
 * connected" is not a job failure — the job must survive indefinitely until
 * a capable worker dials in, not burn through its attempts while the
 * laptop is offline).
 *
 * Backend translation:
 * - BullMQ: the worker rate-limits itself for `delayMs` and rethrows
 *   BullMQ's RateLimitError, which re-queues the job with attemptsMade
 *   unchanged.
 * - Mock: the job is returned to `waiting` with attemptsMade unchanged.
 */
export class RetryJobSignal extends Error {
  constructor(readonly delayMs: number, message = 'job requeued by processor retry signal') {
    super(message)
    this.name = 'RetryJobSignal'
  }
}
