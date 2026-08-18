/**
 * fetchWithRetry — a thin wrapper around the global `fetch` API that retries
 * on transient failures with exponential backoff.
 *
 * Ported unchanged from `apps/scraper/src/util/fetch-with-retry.ts` (#963) —
 * duplicated rather than imported so this app's outbound-HTTP job handlers
 * never pull in apps/scraper's dependency graph.
 *
 * Retryable conditions:
 *   - HTTP 429 (Too Many Requests) — honours `Retry-After` header when present
 *   - HTTP 5xx server errors
 *   - Network-level failures (fetch throws)
 *
 * Non-retryable conditions (abort immediately):
 *   - HTTP 4xx client errors (except 429)
 *   - Successful responses (2xx, 3xx)
 *
 * @param url      - URL to fetch.
 * @param init     - Standard RequestInit options.
 * @param options  - Retry configuration.
 */
import pRetry, { AbortError } from 'p-retry'

export interface FetchWithRetryOptions {
  /** Number of retry attempts after the initial request. Defaults to 3. */
  retries?: number
  /** Base delay in milliseconds between retries (doubles each attempt). Defaults to 500. */
  minTimeout?: number
  /** Maximum delay cap in milliseconds. Defaults to 10_000. */
  maxTimeout?: number
}

function parseRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get('retry-after')
  if (!raw) return null
  // Retry-After is either a number (seconds) or an HTTP-date
  const seconds = parseFloat(raw)
  if (!isNaN(seconds)) return Math.ceil(seconds * 1000)
  const date = Date.parse(raw)
  if (!isNaN(date)) return Math.max(0, date - Date.now())
  return null
}

export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 3
  const minTimeout = options.minTimeout ?? 500
  const maxTimeout = options.maxTimeout ?? 10_000

  return pRetry(
    async (attempt) => {
      let res: Response
      try {
        res = await fetch(url, init)
      } catch (err) {
        // Network-level failure: throw so p-retry handles it
        throw err instanceof Error ? err : new Error(String(err))
      }

      if (res.ok) return res

      if (res.status === 429) {
        // Respect Retry-After if the server sends it
        const retryAfterMs = parseRetryAfterMs(res.headers)
        if (retryAfterMs !== null && retryAfterMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
        }
        throw new Error(`HTTP 429 (attempt ${attempt})`)
      }

      if (res.status >= 500) {
        throw new Error(`HTTP ${res.status} (attempt ${attempt})`)
      }

      // 4xx (except 429): client error — do not retry
      throw new AbortError(`HTTP ${res.status} — not retrying client error`)
    },
    {
      retries,
      minTimeout,
      maxTimeout,
      factor: 2,
    },
  )
}
