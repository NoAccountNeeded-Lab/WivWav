import type { FastifyPluginAsync } from 'fastify'
import type { ApiKeyTier } from '@wivwav/types'
import type { ApiKeyRepository } from '../repositories/index.js'
import { verifyStripeSignature } from '../services/stripe-webhook.js'
import { defaultRateLimitForTier } from '../services/api-key-tier.js'

interface WebhooksPluginOptions {
  apiKeys: ApiKeyRepository
  /** Unset disables the endpoint (503) — mirrors the admin-auth fail-closed pattern for a missing secret. */
  stripeWebhookSecret: string | undefined
}

/** Raw string body plus its parsed JSON — the parser below keeps both so the raw bytes are available for signature verification. */
interface RawJsonBody {
  raw: string
  parsed: unknown
}

interface StripeEventLike {
  type?: unknown
  data?: {
    object?: {
      customer_details?: { email?: unknown } | null
      customer_email?: unknown
      metadata?: Record<string, unknown> | null
    }
  }
}

const TIER_UPGRADE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
])

function extractOwnerEmail(event: StripeEventLike): string | null {
  const obj = event.data?.object
  const metadataEmail = obj?.metadata?.['ownerEmail']
  if (typeof metadataEmail === 'string' && metadataEmail.length > 0) return metadataEmail
  const detailsEmail = obj?.customer_details?.email
  if (typeof detailsEmail === 'string' && detailsEmail.length > 0) return detailsEmail
  if (typeof obj?.customer_email === 'string' && obj.customer_email.length > 0) return obj.customer_email
  return null
}

function extractTier(event: StripeEventLike): ApiKeyTier {
  const metadataTier = event.data?.object?.metadata?.['tier']
  if (metadataTier === 'FREE' || metadataTier === 'PRO' || metadataTier === 'ENTERPRISE') return metadataTier
  // A payment event with no explicit tier metadata still signals a paid upgrade — default to PRO.
  return 'PRO'
}

/**
 * `POST /webhooks/stripe` — flips an API key's tier on a Stripe payment
 * event (#453). Deliberately minimal: it expects the Checkout Session (or
 * subscription) to carry `metadata.ownerEmail` (and optionally
 * `metadata.tier`) set when the session was created — provisioning that
 * Checkout flow itself is out of scope here. Falls back to
 * `customer_details.email` / `customer_email` when metadata is absent, and
 * defaults the tier to PRO for a recognized event with no tier metadata.
 *
 * Not mounted under `/v1` or `/internal` — Stripe calls this directly and
 * authenticates via the signed payload, not an API key or bearer secret.
 */
export const webhooksRoutes: FastifyPluginAsync<WebhooksPluginOptions> = async (app, { apiKeys, stripeWebhookSecret }) => {
  // Capture the raw body alongside the parsed JSON — Stripe's signature is
  // computed over the exact bytes received, which the default JSON parser
  // discards. Scoped to this plugin's own encapsulation only.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    // `parseAs: 'string'` always yields a string at runtime; Fastify's type
    // for this callback is `string | Buffer` regardless (it's shared with
    // `parseAs: 'buffer'`), so normalize defensively rather than assert.
    const raw = typeof body === 'string' ? body : body.toString('utf8')
    try {
      done(null, { raw, parsed: JSON.parse(raw) } satisfies RawJsonBody)
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  app.post<{ Body: RawJsonBody }>('/stripe', async (req, reply) => {
    if (!stripeWebhookSecret) {
      return reply.code(503).send({
        error: { code: 'WEBHOOK_DISABLED', message: 'STRIPE_WEBHOOK_SECRET is not configured' },
      })
    }

    const sigHeader = req.headers['stripe-signature']
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader
    if (!signature || !verifyStripeSignature(req.body.raw, signature, stripeWebhookSecret)) {
      return reply.code(400).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Stripe-Signature header missing or invalid' },
      })
    }

    const event = req.body.parsed as StripeEventLike
    if (typeof event.type === 'string' && TIER_UPGRADE_EVENT_TYPES.has(event.type)) {
      const ownerEmail = extractOwnerEmail(event)
      if (ownerEmail) {
        const tier = extractTier(event)
        await apiKeys.updateTierByOwnerEmail(ownerEmail, tier, defaultRateLimitForTier(tier))
      }
    }

    return reply.code(204).send()
  })
}
