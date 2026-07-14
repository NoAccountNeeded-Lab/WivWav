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
 * During a signing-secret rotation Stripe sends *multiple* `v1=` values
 * (each signed with a different secret); this accepts if any one matches,
 * per Stripe's own guidance — rejecting unless every value matched would
 * break delivery mid-rotation.
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
  let timestamp: string | undefined
  const signatures: string[] = []
  for (const entry of signatureHeader.split(',')) {
    const [key, value] = entry.split('=', 2)
    if (!key || !value) continue
    const trimmedKey = key.trim()
    const trimmedValue = value.trim()
    if (trimmedKey === 't') timestamp = trimmedValue
    else if (trimmedKey === 'v1') signatures.push(trimmedValue)
  }
  if (!timestamp || signatures.length === 0) return false

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  if (Math.abs(now / 1000 - timestampSeconds) > toleranceSeconds) return false

  const expectedSignature = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  const expected = Buffer.from(expectedSignature, 'hex')

  return signatures.some((signature) => {
    const actual = Buffer.from(signature, 'hex')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  })
}
