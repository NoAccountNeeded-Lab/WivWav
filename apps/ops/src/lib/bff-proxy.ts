import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, verifySessionValue } from './session'
import { apiFetch } from './api-fetch'
import { getServerApiBaseUrl } from './api-url'

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

type BffRule = Readonly<{ method: string; path: RegExp }>

/** Explicit browser call-site allowlist; query strings are ignored when matching. */
export const BFF_ALLOWLIST: readonly BffRule[] = [
  { method: 'GET', path: /^\/health$/ },
  { method: 'GET', path: /^\/v1\/listings$/ },
  { method: 'GET', path: /^\/admin\/board(?:\/.*)?$/ },
  { method: 'GET', path: /^\/admin\/(?:queues|sources|runs|repeatables|workers|config|logs|field-conflicts)$/ },
  { method: 'GET', path: /^\/admin\/queues\/[^/]+$/ },
  { method: 'GET', path: /^\/admin\/sources\/[^/]+\/(?:pipeline|job-runs)$/ },
  { method: 'GET', path: /^\/admin\/listing-refresh\/status$/ },
  { method: 'GET', path: /^\/admin\/config\/[^/]+$/ },
  { method: 'GET', path: /^\/admin\/ai\/status$/ },
  { method: 'GET', path: /^\/admin\/private-seller-retention\/listings\/[^/]+\/audit$/ },
  { method: 'POST', path: /^\/admin\/queues\/[^/]+\/(?:pause|resume|jobs)$/ },
  { method: 'POST', path: /^\/admin\/sync$/ },
  { method: 'POST', path: /^\/admin\/sources\/[^/]+\/(?:run|enable|disable)$/ },
  { method: 'POST', path: /^\/admin\/ai\/explain-error$/ },
  { method: 'POST', path: /^\/admin\/private-seller-retention\/listings\/[^/]+\/delete$/ },
  { method: 'POST', path: /^\/internal\/ops\/workers\/[^/]+\/(?:pause|resume)$/ },
  { method: 'POST', path: /^\/internal\/ops\/queues\/[^/]+\/jobs\/[^/]+\/(?:cancel|retry|make-ready)$/ },
  { method: 'POST', path: /^\/internal\/ops\/problem-ack$/ },
  { method: 'POST', path: /^\/internal\/ops\/listings\/[^/]+\/actions$/ },
  { method: 'PUT', path: /^\/admin\/config\/[^/]+$/ },
  { method: 'PUT', path: /^\/admin\/repeatables\/[^/]+$/ },
  { method: 'DELETE', path: /^\/admin\/config\/[^/]+$/ },
  { method: 'DELETE', path: /^\/admin\/repeatables\/[^/]+$/ },
  { method: 'DELETE', path: /^\/admin\/queues\/[^/]+\/failed$/ },
]

export function isAllowedBffRequest(method: string, upstreamPath: string): boolean {
  let pathname: string
  try {
    pathname = new URL(upstreamPath, 'http://bff.invalid').pathname
  } catch {
    return false
  }
  return BFF_ALLOWLIST.some(rule => rule.method === method.toUpperCase() && rule.path.test(pathname))
}

function getTrustedOpsOrigin(): string | null {
  const configured = process.env.OPS_PUBLIC_ORIGIN
  if (!configured) return null
  try {
    const parsed = new URL(configured)
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return null
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * Shared proxy body for the ops BFF: forwards a browser request to the API
 * (or, for Bull Board, to a caller-supplied absolute upstream path), injecting
 * the internal service credential server-side via `apiFetch` so the browser
 * never needs it and never calls `/admin/*` directly.
 *
 * Defense-in-depth: `middleware.ts` already blocks unauthenticated requests to
 * `/api/bff/*` and `/admin/board/*`, but this checks the session again in case
 * a route handler is ever reached by another path.
 *
 * CSRF: this app is same-origin-only (the ops browser client never calls a
 * cross-origin BFF), so for state-changing methods we require the `Origin`
 * header — which browsers attach to fetch/XHR and cannot be forged by a
 * third-party page — to match the configured public ops origin. GET/HEAD/OPTIONS are
 * exempt since they must not mutate state.
 */
export async function proxyToApi(request: Request, upstreamPath: string): Promise<NextResponse> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!verifySessionValue(sessionCookie)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
      { status: 401 },
    )
  }

  const method = request.method.toUpperCase()
  if (!isAllowedBffRequest(method, upstreamPath)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN_PATH', message: 'BFF path or method is not allowed' } },
      { status: 403 },
    )
  }

  if (!SAFE_METHODS.has(method)) {
    const incomingHeaders = await headers()
    const origin = incomingHeaders.get('origin')
    const trustedOrigin = getTrustedOpsOrigin()
    if (!origin || !trustedOrigin) {
      return NextResponse.json(
        { error: { code: 'BAD_ORIGIN', message: 'Origin header required for this request' } },
        { status: 403 },
      )
    }
    try {
      if (new URL(origin).origin !== trustedOrigin) {
        return NextResponse.json(
          { error: { code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' } },
          { status: 403 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: { code: 'BAD_ORIGIN', message: 'Invalid origin header' } },
        { status: 403 },
      )
    }
  }

  const target = `${getServerApiBaseUrl()}${upstreamPath}`
  const contentType = request.headers.get('content-type')
  const hasBody = method !== 'GET' && method !== 'HEAD'

  const upstreamResponse = await apiFetch(target, {
    method,
    headers: contentType ? { 'content-type': contentType } : undefined,
    body: hasBody ? request.body : undefined,
    // Required by fetch when streaming a body from a Request in Node.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)

  const responseContentType = upstreamResponse.headers.get('content-type')
  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    ...(responseContentType ? { headers: { 'content-type': responseContentType } } : {}),
  })
}

/** Builds the upstream path (with query string) from catch-all route params. */
export function buildUpstreamPath(pathSegments: string[] | undefined, search: string, prefix = ''): string {
  const joined = (pathSegments ?? []).map(encodeURIComponent).join('/')
  return `${prefix}${joined ? `/${joined}` : ''}${search}`
}
