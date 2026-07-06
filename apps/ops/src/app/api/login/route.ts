import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { SESSION_COOKIE_NAME, createSessionValue, verifyCredentials } from '@/lib/session'

const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60

const RATE_LIMIT_MAX_ATTEMPTS = 10
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000

/**
 * Best-effort in-memory brute-force guard, keyed by client IP: 10 attempts
 * per 5-minute window. This is intentionally lightweight for a single-operator
 * beta tool — state is per-process (resets on deploy/restart) and not shared
 * across instances. Revisit with a shared store (e.g. Valkey) if this app is
 * ever exposed beyond a trusted network or run with multiple replicas.
 */
const loginAttempts = new Map<string, { count: number; windowStart: number }>()

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(key)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RATE_LIMIT_MAX_ATTEMPTS
}

/**
 * POST /api/login — verifies the operator credential and, on success, sets a
 * signed httpOnly session cookie.
 *
 * CSRF: rejects cross-origin posts by comparing the `Origin` header to the
 * request's own `Host` (browsers attach `Origin` to same-site form/fetch
 * posts and it can't be forged by a third-party page). This is the same
 * mechanism `apps/ops/src/lib/bff-proxy.ts` uses for the rest of the BFF.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const incomingHeaders = await headers()
  const origin = incomingHeaders.get('origin')
  const host = incomingHeaders.get('host')
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ error: { code: 'BAD_ORIGIN', message: 'Cross-origin login rejected' } }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: { code: 'BAD_ORIGIN', message: 'Invalid origin header' } }, { status: 403 })
    }
  }

  const clientIp = incomingHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (isRateLimited(clientIp)) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many login attempts — try again later' } },
      { status: 429 },
    )
  }

  let body: { username?: unknown; password?: unknown }
  try {
    body = await request.json() as { username?: unknown; password?: unknown }
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!verifyCredentials(username, password)) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } }, { status: 401 })
  }

  const cookieStore = await cookies()
  const isProduction = process.env['NODE_ENV'] === 'production'

  cookieStore.set(SESSION_COOKIE_NAME, createSessionValue(), {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })

  return NextResponse.json({ data: { authenticated: true } })
}
