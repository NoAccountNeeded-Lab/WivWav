import type { NextRequest } from 'next/server'
import { buildUpstreamPath, proxyToApi } from '@/lib/bff-proxy'

/**
 * Generic BFF proxy: `/api/bff/<rest>` → API `/<rest>` (1:1, prefix stripped).
 *
 * Covers every JSON call the ops browser clients make — `/admin/*`, `/health`,
 * `/v1/*` — so the browser never talks to the API's `/admin` surface directly
 * (see acceptance criteria on #450). The internal service credential is
 * injected server-side by `apiFetch`; the browser only ever holds the ops
 * session cookie.
 */
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const upstreamPath = buildUpstreamPath(path, request.nextUrl.search)
  return proxyToApi(request, upstreamPath)
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
