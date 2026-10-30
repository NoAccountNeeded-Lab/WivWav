import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { internalConfigRoutes } from './internal-config.js'

function build(entry: unknown, secrets = { internalApiSecret: 'web-secret', opsApiSecret: 'ops-secret' }) {
  const read = vi.fn(async () => entry)
  const app = Fastify()
  void app.register(internalConfigRoutes, {
    prefix: '/internal/config',
    db: { configEntry: { findFirst: read } } as never,
    cache: { get: vi.fn(async () => null), set: vi.fn(async () => {}) } as never,
    ...secrets,
    nodeEnv: 'production',
  })
  return { app, read }
}

const row = {
  id: 'config-1', key: 'ai.intake.model', type: 'string', value: 'test-model',
  description: 'private metadata', hint: null, encryptedValue: null,
  createdAt: new Date(), createdBy: 'private-actor',
}

describe('bounded internal config', () => {
  it.each(['web-secret', 'ops-secret'])('projects only the exact safe model value for %s', async secret => {
    const { app } = build(row)
    const response = await app.inject({ url: '/internal/config/ai.intake.model', headers: { authorization: `Bearer ${secret}` } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: { key: 'ai.intake.model', value: 'test-model' } })
    await app.close()
  })

  it.each([undefined, '', 'wrong', 'diagnostic-secret'])('rejects missing or wrong-scope identity %s', async secret => {
    const { app, read } = build(row)
    const response = await app.inject({ url: '/internal/config/ai.intake.model', ...(secret ? { headers: { authorization: `Bearer ${secret}` } } : {}) })
    expect(response.statusCode).toBe(401)
    expect(read).not.toHaveBeenCalled()
    await app.close()
  })

  it('fails closed when no service credential is configured in production', async () => {
    const { app } = build(row, { internalApiSecret: '', opsApiSecret: '' })
    expect((await app.inject('/internal/config/ai.intake.model')).statusCode).toBe(503)
    await app.close()
  })

  it.each([null, { ...row, value: null }, { ...row, type: 'secret' }, { ...row, type: 'number', value: 12 }, { ...row, value: {} }])('refuses missing, deleted or non-string/secret values', async entry => {
    const { app } = build(entry)
    const response = await app.inject({ url: '/internal/config/ai.intake.model', headers: { authorization: 'Bearer web-secret' } })
    expect(response.statusCode).toBe(404)
    expect(response.body).not.toContain('private')
    await app.close()
  })

  it.each(['/', '/ai.other.model', '/ebay.motors.app-id', '/ai.intake.model/history', '/ai.intake.model/decrypt'])('has no list, arbitrary key, history or decryption endpoint: %s', async path => {
    const { app, read } = build(row)
    expect((await app.inject({ url: `/internal/config${path}`, headers: { authorization: 'Bearer web-secret' } })).statusCode).toBe(404)
    expect(read).not.toHaveBeenCalled()
    await app.close()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('does not provide mutation method %s', async method => {
    const { app, read } = build(row)
    expect((await app.inject({ method, url: '/internal/config/ai.intake.model', headers: { authorization: 'Bearer web-secret' } })).statusCode).toBe(404)
    expect(read).not.toHaveBeenCalled()
    await app.close()
  })
})
