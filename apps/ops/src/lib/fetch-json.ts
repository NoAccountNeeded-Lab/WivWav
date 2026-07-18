import { fetchWithTimeout } from './fetch-with-timeout'

export interface FetchJsonResult<T> {
  data: T | null
  error?: string
}

/**
 * Fetches and JSON-decodes a URL, unwrapping the API's `{ data: T }` success
 * envelope when present. Never throws — network errors, non-2xx responses,
 * and timeouts are all reported via `error` so callers can render an inline
 * failure state instead of crashing the render tree.
 *
 * `init` lets callers POST a body (e.g. the attention-snapshot computation,
 * which takes already-fetched resource state rather than being a GET) while
 * still going through the same envelope-unwrapping and timeout handling.
 */
export async function fetchJson<T>(url: string, timeoutMs = 10_000, init: RequestInit = {}): Promise<FetchJsonResult<T>> {
  try {
    const res = await fetchWithTimeout(url, { cache: 'no-store', ...init }, timeoutMs)
    if (!res.ok) return { data: null, error: `API returned ${res.status}` }
    const body = (await res.json()) as T | { data: T }
    if (isDataEnvelope<T>(body)) return { data: body.data }
    return { data: body }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { data: null, error: 'Request timed out' }
    }
    return { data: null, error: err instanceof Error ? err.message : 'Request failed' }
  }
}

function isDataEnvelope<T>(body: T | { data: T }): body is { data: T } {
  return typeof body === 'object' && body !== null && 'data' in body
}
