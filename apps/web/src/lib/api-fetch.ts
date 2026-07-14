import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'

/**
 * Returns the x-request-id for the current server-side request.
 *
 * Reads the incoming header forwarded by a reverse proxy (e.g. from an
 * upstream caller), or generates a fresh UUID when no header is present.
 * The same value is used for all API calls within a single Next.js request
 * because `headers()` reads from the request-scoped AsyncLocalStorage.
 */
async function getRequestId(): Promise<string> {
  const incomingHeaders = await headers()
  return incomingHeaders.get('x-request-id') ?? randomUUID()
}

/**
 * Drop-in replacement for `fetch` for server-side API calls.
 *
 * Forwards `x-request-id` on every outbound request so that web container
 * log entries can be correlated with Fastify API log entries via a shared
 * requestId. The ID is never surfaced to the browser or in any response body.
 *
 * Also attaches the `INTERNAL_API_SECRET` server-to-server bypass (when
 * configured) so this server-side path keeps working now that `/v1/` routes
 * require an API key (#453) — the same secret already used for
 * `/admin/config/:key/decrypt` calls. Never overrides a caller-supplied
 * `Authorization` header. `INTERNAL_API_SECRET` is server-only (no
 * `NEXT_PUBLIC_` prefix) — this function must never run in the browser.
 */
export async function apiFetch(
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestId = await getRequestId()
  const internalApiSecret = process.env['INTERNAL_API_SECRET']
  const callerHeaders = (init?.headers ?? {}) as Record<string, string>
  const hasAuthHeader = Object.keys(callerHeaders).some((key) => key.toLowerCase() === 'authorization')

  return fetch(url, {
    ...init,
    headers: {
      ...(internalApiSecret && !hasAuthHeader ? { authorization: `Bearer ${internalApiSecret}` } : {}),
      ...callerHeaders,
      'x-request-id': requestId,
    },
  })
}
