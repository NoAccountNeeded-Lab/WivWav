/**
 * Shared helper for detecting Playwright navigation timeout errors.
 *
 * Playwright surfaces timeouts as errors whose message contains
 * "Timeout Nms exceeded" (capital T, numeric N). This pattern matches
 * page.goto(), page.waitForSelector(), and similar navigation calls.
 */
export function isNavigationTimeout(err: unknown): boolean {
  return err instanceof Error && /\bTimeout \d+ms exceeded\b/.test(err.message)
}

/**
 * Retry a navigation action up to `maxAttempts` times on transient timeout.
 * Non-timeout errors are re-thrown immediately on the first occurrence.
 *
 * @param action       Async function that performs the navigation (e.g. goto call).
 * @param maxAttempts  Maximum total attempts, including the first (default: 3).
 * @param backoffMs    Base delay between retries in ms (default: 1000).
 *
 * @throws The last timeout error when all attempts are exhausted.
 * @throws Any non-timeout error immediately.
 */
export async function withNavigationRetry<T>(
  action: () => Promise<T>,
  maxAttempts = 3,
  backoffMs = 1_000,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action()
    } catch (err) {
      if (!isNavigationTimeout(err)) throw err
      lastErr = err
      if (attempt < maxAttempts) {
        await new Promise<void>(resolve => setTimeout(resolve, backoffMs * attempt))
      }
    }
  }
  throw lastErr
}
