import type { NextRequest } from 'next/server'
import { buildUpstreamPath, proxyToApi } from '@/lib/bff-proxy'

/**
 * Bull Board proxy: `/ops/queues/board(/...)` on the ops app maps 1:1 to the API's
 * `/ops/queues/board(/...)`. Mounted at the *same* path (unlike the generic
 * `/ops/api` prefix) because Bull Board's client bundle emits relative/absolute
 * links (`/ops/queues/board/static/...`, `/ops/queues/board/api/...`) built from its own
 * `setBasePath`; keeping the ops-side mount path identical means those links
 * resolve correctly without any rewriting.
 *
 * This is the only authenticated path to Bull Board — the API's own
 * `/ops/queues/board` fails closed per `apps/api/src/plugins/ops-auth.ts`, and
 * this route injects the operator credential server-side after checking the
 * ops session (see `proxyToApi` and `middleware.ts`).
 */
async function handle(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path } = await context.params
  const upstreamPath = buildUpstreamPath(path, request.nextUrl.search, '/ops/queues/board')
  return proxyToApi(request, upstreamPath)
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
