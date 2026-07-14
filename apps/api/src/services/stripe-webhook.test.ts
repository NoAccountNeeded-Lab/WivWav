import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyStripeSignature } from './stripe-webhook.js'

const SECRET = 'whsec_test_secret'

function sign(rawBody: string, timestampSeconds: number, secret = SECRET): string {
  const signature = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')
  return `t=${timestampSeconds},v1=${signature}`
}

describe('verifyStripeSignature', () => {
  it('accepts a correctly signed, fresh payload', () => {
    const rawBody = '{"type":"checkout.session.completed"}'
    const now = 1_700_000_000_000
    const header = sign(rawBody, Math.floor(now / 1000), SECRET)

    expect(verifyStripeSignature(rawBody, header, SECRET, 300, now)).toBe(true)
  })

  it('rejects a signature computed with the wrong secret', () => {
    const rawBody = '{"type":"checkout.session.completed"}'
    const now = 1_700_000_000_000
    const header = sign(rawBody, Math.floor(now / 1000), 'wrong-secret')

    expect(verifyStripeSignature(rawBody, header, SECRET, 300, now)).toBe(false)
  })

  it('rejects a payload that was tampered with after signing', () => {
    const rawBody = '{"type":"checkout.session.completed"}'
    const now = 1_700_000_000_000
    const header = sign(rawBody, Math.floor(now / 1000), SECRET)

    expect(verifyStripeSignature('{"type":"tampered"}', header, SECRET, 300, now)).toBe(false)
  })

  it('rejects a timestamp older than the tolerance window (replay protection)', () => {
    const rawBody = '{"type":"checkout.session.completed"}'
    const now = 1_700_000_000_000
    const staleTimestamp = Math.floor(now / 1000) - 301
    const header = sign(rawBody, staleTimestamp, SECRET)

    expect(verifyStripeSignature(rawBody, header, SECRET, 300, now)).toBe(false)
  })

  it('rejects a header missing the t or v1 field', () => {
    expect(verifyStripeSignature('{}', 'v1=abc', SECRET)).toBe(false)
    expect(verifyStripeSignature('{}', 't=1700000000', SECRET)).toBe(false)
    expect(verifyStripeSignature('{}', '', SECRET)).toBe(false)
  })

  it('ignores a v0 test-mode field and verifies against v1', () => {
    const rawBody = '{"type":"checkout.session.completed"}'
    const now = 1_700_000_000_000
    const timestampSeconds = Math.floor(now / 1000)
    const validSig = createHmac('sha256', SECRET).update(`${timestampSeconds}.${rawBody}`).digest('hex')
    const header = `t=${timestampSeconds},v1=${validSig},v0=deadbeef`

    expect(verifyStripeSignature(rawBody, header, SECRET, 300, now)).toBe(true)
  })

  it('accepts when any of multiple v1 signatures matches (secret-rotation window)', () => {
    const rawBody = '{"type":"checkout.session.completed"}'
    const now = 1_700_000_000_000
    const timestampSeconds = Math.floor(now / 1000)
    const oldSecretSig = createHmac('sha256', 'previous-secret').update(`${timestampSeconds}.${rawBody}`).digest('hex')
    const currentSecretSig = createHmac('sha256', SECRET).update(`${timestampSeconds}.${rawBody}`).digest('hex')
    const header = `t=${timestampSeconds},v1=${oldSecretSig},v1=${currentSecretSig}`

    expect(verifyStripeSignature(rawBody, header, SECRET, 300, now)).toBe(true)
  })

  it('rejects when none of multiple v1 signatures matches', () => {
    const rawBody = '{"type":"checkout.session.completed"}'
    const now = 1_700_000_000_000
    const timestampSeconds = Math.floor(now / 1000)
    const wrongSig1 = createHmac('sha256', 'wrong-secret-1').update(`${timestampSeconds}.${rawBody}`).digest('hex')
    const wrongSig2 = createHmac('sha256', 'wrong-secret-2').update(`${timestampSeconds}.${rawBody}`).digest('hex')
    const header = `t=${timestampSeconds},v1=${wrongSig1},v1=${wrongSig2}`

    expect(verifyStripeSignature(rawBody, header, SECRET, 300, now)).toBe(false)
  })
})
