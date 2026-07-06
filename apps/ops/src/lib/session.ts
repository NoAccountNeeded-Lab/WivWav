import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** Name of the signed session cookie set on successful login. */
export const SESSION_COOKIE_NAME = 'ops_session'

/** Session lifetime: 12 hours. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

interface SessionPayload {
  /** Expiry as a Unix ms timestamp. */
  exp: number
}

/**
 * Returns the session-signing secret.
 *
 * In production this must be set explicitly (fails closed — see
 * `requireSessionSecret`). In development/test, falls back to a fixed
 * placeholder so local workflows don't require extra setup.
 */
function getSessionSecret(): string | undefined {
  return process.env['OPS_SESSION_SECRET']
}

/** Throws if running in production without a configured session secret. */
export function requireSessionSecret(): string {
  const secret = getSessionSecret()
  if (secret) return secret
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'OPS_SESSION_SECRET must be set in production — operator sessions cannot be signed without it',
    )
  }
  // Non-production fallback only. Never reachable in production because of the throw above.
  return 'dev-only-insecure-ops-session-secret'
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** Creates a signed session cookie value good for `SESSION_TTL_MS`. */
export function createSessionValue(): string {
  const secret = requireSessionSecret()
  const payload: SessionPayload = { exp: Date.now() + SESSION_TTL_MS }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign(payloadB64, secret)
  return `${payloadB64}.${signature}`
}

/** Verifies a session cookie value's signature and expiry. */
export function verifySessionValue(value: string | undefined): boolean {
  if (!value) return false
  const [payloadB64, signature] = value.split('.')
  if (!payloadB64 || !signature) return false

  const secret = requireSessionSecret()
  const expectedSignature = sign(payloadB64, secret)

  if (!constantTimeStringsEqual(signature, expectedSignature)) return false

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload
    return typeof payload.exp === 'number' && payload.exp > Date.now()
  } catch {
    return false
  }
}

/**
 * Constant-time string comparison that doesn't leak the expected value's
 * length: both inputs are hashed to a fixed-size digest first, so the
 * `timingSafeEqual` call always compares equal-length buffers regardless of
 * how long `actual`/`expected` are. Comparing raw buffers directly would let
 * an attacker learn the secret's length from whether the length check
 * short-circuits before the timing-safe comparison even runs.
 */
function constantTimeStringsEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

/**
 * Verifies the operator-supplied credential against the configured single
 * shared credential (`OPS_ADMIN_PASSWORD`). Optional `OPS_ADMIN_USERNAME`
 * defaults to "operator" when unset. Uses a timing-safe comparison.
 *
 * Single strong credential is acceptable for single-operator beta per #666
 * decision D1; OIDC is the upgrade path once operator count grows.
 */
export function verifyCredentials(username: string, password: string): boolean {
  const expectedUsername = process.env['OPS_ADMIN_USERNAME'] ?? 'operator'
  const expectedPassword = process.env['OPS_ADMIN_PASSWORD']
  if (!expectedPassword) return false

  const usernameMatches = constantTimeStringsEqual(username, expectedUsername)
  const passwordMatches = constantTimeStringsEqual(password, expectedPassword)

  return usernameMatches && passwordMatches
}
