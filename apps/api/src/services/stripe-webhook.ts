import { createHmac, timingSafeEqual } from 'node:crypto'

/** Default tolerance Stripe itself recommends between the signed timestamp and now, to reject replayed payloads. */
const DEFAULT_TOLERANCE_SECONDS = 300

/**
 * Verifies a Stripe `Stripe-Signature` header against the raw request body,
 * per Stripe's documented scheme (https://docs.stripe.com/webhooks/signatures):
 * `t=<unix-seconds>,v1=<hex-hmac-sha256>[,v0=...]`, where the signed message
 * is `${timestamp}.${rawBody}`. Implemented directly with `node:crypto`
 * rather than the `stripe` SDK to avoid an extra runtime dependency for a
 * single HMAC check.
 *
 * Returns false for a missing/malformed header, a signature mismatch, or a
 * timestamp older than `toleranceSeconds` (replay protection — never pass 0,
 * which disables the recency check entirely).
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  now: number = Date.now(),
): boolean {
  const parts = new Map<string, string>()
  for (const entry of signatureHeader.split(',')) {
    const [key, value] = entry.split('=', 2)
    if (key && value) parts.set(key.trim(), value.trim())
  }

  const timestamp = parts.get('t')
  const signature = parts.get('v1')
  if (!timestamp || !signature) return false

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  if (Math.abs(now / 1000 - timestampSeconds) > toleranceSeconds) return false

  const expectedSignature = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  const expected = Buffer.from(expectedSignature, 'hex')
  const actual = Buffer.from(signature, 'hex')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}
