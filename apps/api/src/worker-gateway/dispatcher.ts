import { RetryJobSignal } from '@wivwav/queue'
import { buildCorrelationId } from '@wivwav/types/worker-protocol'
import type { WivWavLogger } from '@wivwav/logger'
import type { WorkerRegistry } from './registry.js'

/** How long a gateway processor rate-limits its queue when no worker qualifies. */
export const NO_WORKER_RETRY_DELAY_MS = 15_000

interface PendingDispatch {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  connectionId: string
  sourceId: string | undefined
  timer: NodeJS.Timeout
}

/**
 * Bridges BullMQ processors to connected workers (#948): a gateway processor
 * awaits `dispatch()`, whose promise settles when the worker's completion
 * callback (POST /internal/workers/jobs/complete) lands in this same
 * process, or rejects on timeout/refusal/disconnect so BullMQ retries the
 * job. Idempotent ingest endpoints make those retries safe.
 *
 * Rejection uses `RetryJobSignal` (no attempt consumed) whenever the failure
 * reflects worker *availability*, not the job itself: no eligible worker,
 * a worker's explicit refusal, a send() that fails because the socket had
 * already gone bad, or a mid-flight disconnect. A real `Error` (attempt
 * consumed) is reserved for the two cases that are actually informative
 * about the job: the worker reporting `success: false`, and the completion
 * timeout — `WORKER_JOB_TIMEOUT_MS` is already generous (browser jobs
 * legitimately run for many minutes), so reaching it signals a genuinely
 * hung job or worker, not routine unavailability.
 */
export class WorkerDispatcher {
  private readonly pending = new Map<string, PendingDispatch>()

  constructor(
    private readonly registry: WorkerRegistry,
    private readonly timeoutMs: number,
    private readonly logger?: WivWavLogger,
  ) {}

  /**
   * Dispatches one queue job to an eligible worker and resolves with the
   * worker's reported `result` (queue-specific, opaque) when it completes.
   * Throws/rejects with RetryJobSignal — putting the job back in the
   * waiting state without consuming an attempt — when no eligible worker is
   * connected, the source's concurrency slot is taken, or the picked
   * worker's connection turns out to be dead.
   */
  async dispatch(
    queueName: string,
    jobId: string,
    payload: unknown,
    requirements: { chromium: boolean; sourceId?: string | undefined },
  ): Promise<unknown> {
    const correlationId = buildCorrelationId(queueName, jobId)

    // A BullMQ retry of a job whose previous dispatch is still pending (e.g.
    // a stalled-job re-poll racing a slow worker): fail the stale entry so
    // exactly one dispatch per correlation id is ever awaited.
    const stale = this.pending.get(correlationId)
    if (stale) this.settle(correlationId, new Error('superseded by a re-dispatch of the same job'))

    const { sourceId } = requirements
    if (sourceId !== undefined && !this.registry.tryAcquireSourceLock(sourceId, correlationId)) {
      throw new RetryJobSignal(
        NO_WORKER_RETRY_DELAY_MS,
        `source ${sourceId} already has a job in flight`,
      )
    }

    const worker = this.registry.pickWorker({ chromium: requirements.chromium })
    if (!worker) {
      this.releaseLockIfHeld(sourceId, correlationId)
      throw new RetryJobSignal(NO_WORKER_RETRY_DELAY_MS, 'no eligible worker connected')
    }

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(
          correlationId,
          new Error(`worker did not report completion within ${this.timeoutMs}ms`),
        )
      }, this.timeoutMs)
      timer.unref()

      this.pending.set(correlationId, {
        resolve,
        reject,
        connectionId: worker.connectionId,
        sourceId,
        timer,
      })
      worker.inFlight.add(correlationId)
      this.logger?.info(
        {
          correlationId,
          queue: queueName,
          workerId: worker.workerId,
          workerName: worker.workerName,
        },
        '[worker-gateway] dispatching job',
      )
      try {
        worker.send({ type: 'job-dispatch', correlationId, queueName, payload })
      } catch (err) {
        // The registry believed this connection was live, but the socket
        // write itself failed (e.g. it closed in the gap between pickWorker()
        // and send()) — an infrastructure hiccup, not a job failure.
        this.settle(
          correlationId,
          new RetryJobSignal(NO_WORKER_RETRY_DELAY_MS, `failed to send to worker: ${String(err)}`),
        )
      }
    })
  }

  /**
   * Settles a dispatch from the worker's completion callback. Returns false
   * for an unknown correlation id (already timed out, or a duplicate
   * callback) — the route reports that distinctly instead of 500ing.
   */
  complete(
    correlationId: string,
    success: boolean,
    errorMessage?: string,
    result?: unknown,
  ): boolean {
    if (!this.pending.has(correlationId)) return false
    this.settle(
      correlationId,
      success ? undefined : new Error(errorMessage ?? 'worker reported failure'),
      result,
    )
    return true
  }

  /** A worker refused a dispatch (`accepted: false` ack): not a job failure — retry without penalty. */
  refuse(correlationId: string, reason: string): void {
    if (!this.pending.has(correlationId)) return
    this.settle(
      correlationId,
      new RetryJobSignal(NO_WORKER_RETRY_DELAY_MS, `worker refused dispatch: ${reason}`),
    )
  }

  /** A connection dropped: fail every dispatch in flight on it, without penalty — see class docstring. */
  failConnection(connectionId: string, reason: string): void {
    for (const worker of [this.registry.get(connectionId)]) {
      for (const correlationId of worker?.inFlight ?? []) {
        this.settle(correlationId, new RetryJobSignal(NO_WORKER_RETRY_DELAY_MS, reason))
      }
    }
  }

  private releaseLockIfHeld(sourceId: string | undefined, correlationId: string): void {
    if (sourceId !== undefined) this.registry.releaseSourceLock(sourceId, correlationId)
  }

  private settle(correlationId: string, error: Error | undefined, result?: unknown): void {
    const entry = this.pending.get(correlationId)
    if (!entry) return
    this.pending.delete(correlationId)
    clearTimeout(entry.timer)
    this.releaseLockIfHeld(entry.sourceId, correlationId)
    this.registry.get(entry.connectionId)?.inFlight.delete(correlationId)
    if (error) {
      this.logger?.warn({ correlationId, err: error }, '[worker-gateway] dispatch failed')
      entry.reject(error)
    } else {
      this.logger?.info({ correlationId }, '[worker-gateway] dispatch completed')
      entry.resolve(result)
    }
  }
}
