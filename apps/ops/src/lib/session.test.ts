import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSessionValue,
  requireSessionSecret,
  verifyCredentials,
  verifySessionValue,
} from './session'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env['OPS_SESSION_SECRET'] = 'test-session-secret'
  process.env['OPS_ADMIN_PASSWORD'] = 'correct-horse-battery-staple'
  delete process.env['OPS_ADMIN_USERNAME']
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.env = { ...ORIGINAL_ENV }
})

describe('session cookie signing', () => {
  it('creates a session value that verifies successfully', () => {
    const value = createSessionValue()
    expect(verifySessionValue(value)).toBe(true)
  })

  it('rejects an undefined value', () => {
    expect(verifySessionValue(undefined)).toBe(false)
  })

  it('rejects a malformed value with no signature segment', () => {
    expect(verifySessionValue('not-a-valid-cookie')).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const value = createSessionValue()
    const [, signature] = value.split('.')
    const tamperedPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 999_999 })).toString('base64url')
    expect(verifySessionValue(`${tamperedPayload}.${signature}`)).toBe(false)
  })

  it('rejects a value signed with a different secret', () => {
    const value = createSessionValue()
    process.env['OPS_SESSION_SECRET'] = 'a-different-secret'
    expect(verifySessionValue(value)).toBe(false)
  })

  it('rejects an expired session', () => {
    const [payloadB64] = createSessionValue().split('.')
    void payloadB64
    // Build an already-expired payload signed with the current secret by
    // reaching into the same signing primitive indirectly (TTL is fixed in
    // createSessionValue, so we simulate an expired payload directly here).
    const expiredPayload = Buffer.from(JSON.stringify({ exp: Date.now() - 1000 })).toString('base64url')
    const signature = createHmac('sha256', 'test-session-secret').update(expiredPayload).digest('base64url')
    expect(verifySessionValue(`${expiredPayload}.${signature}`)).toBe(false)
  })
})

describe('requireSessionSecret — production fail-closed', () => {
  it('throws when NODE_ENV is production and OPS_SESSION_SECRET is unset', () => {
    delete process.env['OPS_SESSION_SECRET']
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => requireSessionSecret()).toThrow(/OPS_SESSION_SECRET must be set in production/)
  })

  it('falls back to the insecure dev secret outside production when unset', () => {
    delete process.env['OPS_SESSION_SECRET']
    vi.stubEnv('NODE_ENV', 'development')
    expect(requireSessionSecret()).toBe('dev-only-insecure-ops-session-secret')
  })

  it('uses the configured secret even in production when set', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(requireSessionSecret()).toBe('test-session-secret')
  })
})

describe('verifyCredentials', () => {
  it('accepts the correct password with the default username', () => {
    expect(verifyCredentials('operator', 'correct-horse-battery-staple')).toBe(true)
  })

  it('rejects an incorrect password', () => {
    expect(verifyCredentials('operator', 'wrong-password')).toBe(false)
  })

  it('rejects when OPS_ADMIN_PASSWORD is not configured', () => {
    delete process.env['OPS_ADMIN_PASSWORD']
    expect(verifyCredentials('operator', 'anything')).toBe(false)
  })

  it('respects a configured OPS_ADMIN_USERNAME', () => {
    process.env['OPS_ADMIN_USERNAME'] = 'alice'
    expect(verifyCredentials('alice', 'correct-horse-battery-staple')).toBe(true)
    expect(verifyCredentials('operator', 'correct-horse-battery-staple')).toBe(false)
  })
})
