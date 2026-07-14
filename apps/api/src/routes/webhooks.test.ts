import { createHmac } from 'node:crypto'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { webhooksRoutes } from './webhooks.js'
import type { ApiKeyRepository } from '../repositories/index.js'

const SECRET = 'whsec_test_secret'

function signedHeader(rawBody: string, timestampSeconds = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac('sha256', SECRET).update(`${timestampSeconds}.${rawBody}`).digest('hex')
  return `t=${timestampSeconds},v1=${signature}`
}

// Note: a default parameter here would NOT help a test that wants "no secret
// configured" — explicitly passing `undefined` still triggers a JS default
// value, silently defeating that scenario. Callers always state their intent.
function buildTestApp(apiKeys: Partial<ApiKeyRepository>, stripeWebhookSecret: string | undefined) {
  const app = Fastify()
  void app.register(webhooksRoutes, { prefix: '/webhooks', apiKeys: apiKeys as ApiKeyRepository, stripeWebhookSecret })
  return app
}

describe('POST /webhooks/stripe', () => {
  it('returns 503 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    const app = buildTestApp({}, undefined)
    const rawBody = JSON.stringify({ type: 'checkout.session.completed' })

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: rawBody,
      headers: { 'content-type': 'application/json' },
    })

    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('returns 400 when the Stripe-Signature header is missing', async () => {
    const app = buildTestApp({}, SECRET)
    const rawBody = JSON.stringify({ type: 'checkout.session.completed' })

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: rawBody,
      headers: { 'content-type': 'application/json' },
    })

    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('returns 400 when the signature does not match the raw body', async () => {
    const app = buildTestApp({}, SECRET)
    const rawBody = JSON.stringify({ type: 'checkout.session.completed' })

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: rawBody,
      headers: { 'content-type': 'application/json', 'stripe-signature': signedHeader('{"different":"body"}') },
    })

    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('updates the owner tier for a checkout.session.completed event with metadata', async () => {
    const updateTierByOwnerEmail = vi.fn(async () => 1)
    const app = buildTestApp({ updateTierByOwnerEmail }, SECRET)
    const rawBody = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { metadata: { ownerEmail: 'buyer@example.com', tier: 'PRO' } } },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: rawBody,
      headers: { 'content-type': 'application/json', 'stripe-signature': signedHeader(rawBody) },
    })

    expect(response.statusCode).toBe(204)
    expect(updateTierByOwnerEmail).toHaveBeenCalledWith('buyer@example.com', 'PRO', 600)
    await app.close()
  })

  it('falls back to customer_details.email and defaults to PRO when metadata is absent', async () => {
    const updateTierByOwnerEmail = vi.fn(async () => 1)
    const app = buildTestApp({ updateTierByOwnerEmail }, SECRET)
    const rawBody = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { customer_details: { email: 'buyer@example.com' } } },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: rawBody,
      headers: { 'content-type': 'application/json', 'stripe-signature': signedHeader(rawBody) },
    })

    expect(response.statusCode).toBe(204)
    expect(updateTierByOwnerEmail).toHaveBeenCalledWith('buyer@example.com', 'PRO', 600)
    await app.close()
  })

  it('does not update any tier when no owner email can be found', async () => {
    const updateTierByOwnerEmail = vi.fn(async () => 0)
    const app = buildTestApp({ updateTierByOwnerEmail }, SECRET)
    const rawBody = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } })

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: rawBody,
      headers: { 'content-type': 'application/json', 'stripe-signature': signedHeader(rawBody) },
    })

    expect(response.statusCode).toBe(204)
    expect(updateTierByOwnerEmail).not.toHaveBeenCalled()
    await app.close()
  })

  it('ignores event types that are not tier-upgrade events', async () => {
    const updateTierByOwnerEmail = vi.fn(async () => 0)
    const app = buildTestApp({ updateTierByOwnerEmail }, SECRET)
    const rawBody = JSON.stringify({
      type: 'invoice.paid',
      data: { object: { metadata: { ownerEmail: 'buyer@example.com' } } },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: rawBody,
      headers: { 'content-type': 'application/json', 'stripe-signature': signedHeader(rawBody) },
    })

    expect(response.statusCode).toBe(204)
    expect(updateTierByOwnerEmail).not.toHaveBeenCalled()
    await app.close()
  })
})
