/** Worker capabilities a job can ask the coordinator to be re-dispatched to. */
export type EscalatedCapability = 'chromium'

/**
 * Thrown by a scraper adapter that cannot finish a job on the worker it is
 * running on but could on a worker with `capability` (#1043 — e.g. BLVD hits
 * a bot block over plain HTTP on a Chromium-free worker).
 *
 * Deliberately separate from `RetryJobSignal` (which means "no worker was
 * available") and from ordinary errors (which mark the source errored and
 * consume a retry attempt): an escalation is neither a failure of the source
 * nor of the job. Every catch between the adapter and the worker's
 * completion report must let it through untouched, and must not record it
 * as a completed scrape or publish a partial listing set.
 *
 * This module has no runtime dependencies on purpose — it is exposed through
 * its own `@wivwav/queue/escalate-capability-signal` subpath so workers can
 * import it without loading bullmq.
 */
export class EscalateCapabilitySignal extends Error {
  constructor(
    readonly capability: EscalatedCapability,
    readonly reason: string,
  ) {
    super(`job requires capability '${capability}': ${reason}`)
    this.name = 'EscalateCapabilitySignal'
  }
}

/** Name-based so it still matches across duplicated module instances. */
export function isEscalateCapabilitySignal(err: unknown): err is EscalateCapabilitySignal {
  return (
    err instanceof EscalateCapabilitySignal ||
    (err instanceof Error &&
      err.name === 'EscalateCapabilitySignal' &&
      (err as { capability?: unknown }).capability === 'chromium' &&
      typeof (err as { reason?: unknown }).reason === 'string')
  )
}
