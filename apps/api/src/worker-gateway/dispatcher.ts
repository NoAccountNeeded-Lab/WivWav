import { randomUUID } from 'node:crypto'
import { RetryJobSignal } from '@wivwav/queue'
import { buildCorrelationId } from '@wivwav/types/worker-protocol'
import type { WivWavLogger } from '@wivwav/logger'
import type { WorkerJobEscalation } from '@wivwav/types/worker-protocol'
import type { WorkerRegistry } from './registry.js'

/** How long a gateway processor rate-limits its queue when no worker qualifies. */
export const NO_WORKER_RETRY_DELAY_MS = 15_000

/**
 * Rejection a dispatch settles with when the worker reported a capability
 * escalation (#1043) instead of an outcome. The gateway processor — not the
 * dispatcher — decides what to do with it (persist the requirement, requeue,
 * or fail if the job was already escalated), so this carries only the request.
 */
export class CapabilityEscalationError extends Error {
  constructor(readonly escalation: WorkerJobEscalation) {
    super(`worker requested capability '${escalation.capability}': ${escalation.reason}`)
    this.name = 'CapabilityEscalationError'
  }
}

interface PendingDispatch {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  connectionId: string
  sourceId: string | undefined
  timer: NodeJS.Timeout
  /**
   * Fresh per dispatch attempt (see worker-protocol.ts's `job-dispatch`
   * docstring) — fences a stale worker's late ack/completion for a
   * correlationId that has since been re-dispatched to another connection
   * from incorrectly settling the *new* attempt.
   */
  dispatchId: string
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
    requirements: { chromium: boolean; httpEnrich?: boolean; sourceId?: string | undefined },
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

    const worker = this.registry.pickWorker({
      chromium: requirements.chromium,
      ...(requirements.httpEnrich !== undefined ? { httpEnrich: requirements.httpEnrich } : {}),
    })
    if (!worker) {
      this.releaseLockIfHeld(sourceId, correlationId)
      throw new RetryJobSignal(NO_WORKER_RETRY_DELAY_MS, 'no eligible worker connected')
    }

    const dispatchId = randomUUID()

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
        dispatchId,
      })
      worker.inFlight.add(correlationId)
      this.logger?.info(
        {
          correlationId,
          dispatchId,
          queue: queueName,
          workerId: worker.workerId,
          workerName: worker.workerName,
        },
        '[worker-gateway] dispatching job',
      )
      try {
        worker.send({ type: 'job-dispatch', correlationId, dispatchId, queueName, payload })
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
   * callback) — the route reports that distinctly instead of 500ing. Also
   * returns false, without touching the current pending entry, when
   * `dispatchId` doesn't match: that means this report belongs to a prior
   * attempt that has since been superseded by a re-dispatch (e.g. after a
   * connection drop), so settling it now would incorrectly resolve the *new*
   * attempt with the old worker's stale result.
   */
  complete(
    correlationId: string,
    dispatchId: string,
    success: boolean,
    errorMessage?: string,
    result?: unknown,
    escalation?: WorkerJobEscalation,
  ): boolean {
    const entry = this.pending.get(correlationId)
    if (!entry) return false
    if (entry.dispatchId !== dispatchId) {
      this.logger?.warn(
        { correlationId, dispatchId, currentDispatchId: entry.dispatchId },
        '[worker-gateway] completion dispatchId mismatch; ignoring stale report',
      )
      return false
    }
    this.settle(
      correlationId,
      escalation !== undefined && !success
        ? new CapabilityEscalationError(escalation)
        : success
          ? undefined
          : new Error(errorMessage ?? 'worker reported failure'),
      result,
    )
    return true
  }

  /** A worker refused a dispatch (`accepted: false` ack): not a job failure — retry without penalty. */
  refuse(correlationId: string, dispatchId: string, reason: string): void {
    const entry = this.pending.get(correlationId)
    if (!entry || entry.dispatchId !== dispatchId) return
    this.settle(
      correlationId,
      new RetryJobSignal(NO_WORKER_RETRY_DELAY_MS, `worker refused dispatch: ${reason}`),
    )
  }

  /** A connection dropped: fail every dispatch in flight on it, without penalty — see class docstring. */
  failConnection(connectionId: string, reason: string): void {
    // Keyed off our own pending map, not the registry: the WS close handler
    // unregisters the connection *before* calling this, so a registry lookup
    // would find nothing and leave the dispatch hanging until its timeout.
    const affected = [...this.pending.entries()]
      .filter(([, entry]) => entry.connectionId === connectionId)
      .map(([correlationId]) => correlationId)
    for (const correlationId of affected) {
      this.settle(correlationId, new RetryJobSignal(NO_WORKER_RETRY_DELAY_MS, reason))
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
      if (error instanceof CapabilityEscalationError) {
        this.logger?.info(
          { correlationId, capability: error.escalation.capability, reason: error.escalation.reason },
          '[worker-gateway] worker requested capability escalation',
        )
      } else {
        this.logger?.warn({ correlationId, err: error }, '[worker-gateway] dispatch failed')
      }
      entry.reject(error)
    } else {
      this.logger?.info({ correlationId }, '[worker-gateway] dispatch completed')
      entry.resolve(result)
    }
  }
}
