const DEFAULT_PUBLIC_API_URL = 'http://localhost:4001'

export function getServerApiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_PUBLIC_API_URL
}

/**
 * Base URL browser code should use for API-shaped calls (`/internal/ops/*`, `/health`,
 * `/v1/*`).
 *
 * Always same-origin and relative (`/ops/api`) — the browser never talks to
 * the API host directly. `/ops/api/[...path]/route.ts` proxies to the real
 * API server-side, injecting the internal service credential and requiring
 * the operator's ops session. See #450: this is the BFF boundary that keeps
 * `/internal/ops/*` calls out of the browser entirely.
 */
export function getPublicApiBaseUrl(): string {
  return '/ops/api'
}
