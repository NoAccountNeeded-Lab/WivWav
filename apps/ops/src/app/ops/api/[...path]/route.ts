import type { NextRequest } from 'next/server'
import { buildUpstreamPath, proxyToApi } from '@/lib/bff-proxy'

/**
 * Allowlisted BFF proxy: `/ops/api/<rest>` → API `/<rest>` (1:1, prefix stripped).
 *
 * The path and method allowlist lives in `bff-proxy.ts`; the browser never
 * talks to the API's privileged surface directly. The internal service
 * credential is injected server-side by `apiFetch`; the browser only ever
 * holds the ops session cookie.
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
