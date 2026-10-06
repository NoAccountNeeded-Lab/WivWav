/**
 * Bounded retry for transient network failures on a single HTTP request.
 *
 * A dropped connection (`socket hang up`, `ECONNRESET`) or a stalled request
 * on one page should not fail a whole multi-hundred-request source run. Only
 * errors that look transient are retried; anything else (HTTP-level refusals,
 * cross-host redirect rejection, programming errors) is rethrown immediately.
 */

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ECONNABORTED'])
const TRANSIENT_MESSAGE = /socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|Request timed out after \d+ms/i

export function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as NodeJS.ErrnoException).code
  if (code && TRANSIENT_CODES.has(code)) return true
  return TRANSIENT_MESSAGE.test(err.message)
}

export interface TransientRetryOptions {
  /** Total attempts including the first (default 3). */
  maxAttempts?: number
  /** Base delay in ms; attempt N waits roughly `backoffMs * N` plus jitter (default 1000). */
  backoffMs?: number
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

/** Delay before retry `attempt` (1-based): linear backoff with +/-20% jitter. */
function retryDelay(attempt: number, backoffMs: number): number {
  const base = backoffMs * attempt
  return Math.max(0, base + base * 0.2 * (2 * Math.random() - 1))
}

export async function withTransientNetworkRetry<T>(
  action: () => Promise<T>,
  options: TransientRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const backoffMs = options.backoffMs ?? 1_000
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action()
    } catch (err) {
      if (!isTransientNetworkError(err)) throw err
      lastErr = err
      if (attempt < maxAttempts) await sleep(retryDelay(attempt, backoffMs))
    }
  }
  throw lastErr
}
