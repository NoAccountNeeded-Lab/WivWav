import type { NextRequest } from 'next/server'
import { buildUpstreamPath, proxyToApi } from '@/lib/bff-proxy'

/**
 * Bull Board proxy: `/admin/board(/...)` on the ops app maps 1:1 to the API's
 * `/admin/board(/...)`. Mounted at the *same* path (unlike the generic
 * `/api/bff` prefix) because Bull Board's client bundle emits relative/absolute
 * links (`/admin/board/static/...`, `/admin/board/api/...`) built from its own
 * `setBasePath`; keeping the ops-side mount path identical means those links
 * resolve correctly without any rewriting.
 *
 * This is the only authenticated path to Bull Board — the API's own
 * `/admin/board` fails closed per `apps/api/src/plugins/admin-auth.ts`, and
 * this route injects the internal credential server-side after checking the
 * ops session (see `proxyToApi` and `middleware.ts`).
 */
async function handle(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path } = await context.params
  const upstreamPath = buildUpstreamPath(path, request.nextUrl.search, '/admin/board')
  return proxyToApi(request, upstreamPath)
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
