import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME, verifySessionValue } from './lib/session'

/**
 * Gates every ops page and BFF call behind the operator session cookie.
 *
 * - `/ops/api/*` (JSON proxy to the API's `/internal/ops`, `/health`, `/v1` surfaces):
 *   401 JSON when unauthenticated — these are always fetched by client JS, never
 *   top-level navigations, so a redirect would be silently followed and break
 *   the caller's JSON parsing.
 * - `/ops/queues/board*` (Bull Board, proxied 1:1 by `apps/ops/src/app/ops/queues/board`):
 *   redirect to `/login` on a top-level navigation (the operator clicking the
 *   "Bull Board" link); 401 JSON for Bull Board's own sub-resource fetches.
 * - Everything else under this matcher (ops pages, status page, root): redirect
 *   to `/login?redirect=<original path>`.
 *
 * `/login` and `/api/login` are excluded via the matcher below so the login
 * flow itself is never gated.
 *
 * Runs in the Node.js middleware runtime (not Edge) because session
 * verification uses `node:crypto` (HMAC signing, timing-safe compare).
 */
export function middleware(request: NextRequest) {
  // Retired namespaces are denied before session redirects; no compatibility alias.
  const retired = ['/admin', '/api/bff']
  if (retired.some(prefix => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`))) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })
  }
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (verifySessionValue(sessionCookie)) {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl
  const isNavigation = request.headers.get('sec-fetch-mode') === 'navigate'

  if (pathname.startsWith('/ops/api') || (pathname.startsWith('/ops/queues/board') && !isNavigation)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
      { status: 401 },
    )
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('redirect', pathname + request.nextUrl.search)
  return NextResponse.redirect(loginUrl)
}

// Node.js middleware runtime (not Edge) — session verification uses node:crypto.
export const runtime = 'nodejs'

export const config = {
  matcher: ['/((?!login|api/login|_next|favicon.ico).*)'],
}
