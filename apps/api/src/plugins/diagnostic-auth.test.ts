import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { diagnosticAuthPlugin } from './diagnostic-auth.js'

function buildTestApp(opts: {
  diagnosticApiSecret: string | undefined
  internalApiSecret: string | undefined
  nodeEnv: 'development' | 'test' | 'production'
}) {
  const app = Fastify()
  void app.register(
    async (diagnosticScope) => {
      await diagnosticAuthPlugin(diagnosticScope, opts)
      diagnosticScope.get('/whoami', async () => ({ data: 'ok' }))
    },
    { prefix: '/diagnostics' },
  )
  return app
}

describe('diagnosticAuthPlugin', () => {
  it('fails closed in production with no diagnostic secret configured', async () => {
    const app = buildTestApp({
      diagnosticApiSecret: undefined,
      internalApiSecret: undefined,
      nodeEnv: 'production',
    })
    const response = await app.inject({ method: 'GET', url: '/diagnostics/whoami' })
    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).error.code).toBe('DIAGNOSTIC_DISABLED')
    await app.close()
  })

  it('fails closed in production even when only INTERNAL_API_SECRET is configured', async () => {
    const app = buildTestApp({
      diagnosticApiSecret: undefined,
      internalApiSecret: 'shared-internal-secret',
      nodeEnv: 'production',
    })
    const response = await app.inject({ method: 'GET', url: '/diagnostics/whoami' })
    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).error.code).toBe('DIAGNOSTIC_DISABLED')
    await app.close()
  })

  it('rejects requests without a valid bearer token when a secret is configured', async () => {
    const app = buildTestApp({
      diagnosticApiSecret: 'diagnostic-secret-value',
      internalApiSecret: undefined,
      nodeEnv: 'production',
    })
    const response = await app.inject({ method: 'GET', url: '/diagnostics/whoami' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects requests with an incorrect bearer token', async () => {
    const app = buildTestApp({
      diagnosticApiSecret: 'diagnostic-secret-value',
      internalApiSecret: undefined,
      nodeEnv: 'production',
    })
    const response = await app.inject({
      method: 'GET',
      url: '/diagnostics/whoami',
      headers: { authorization: 'Bearer wrong-value' },
    })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('accepts requests with a valid DIAGNOSTIC_API_SECRET bearer token', async () => {
    const app = buildTestApp({
      diagnosticApiSecret: 'diagnostic-secret-value',
      internalApiSecret: undefined,
      nodeEnv: 'production',
    })
    const response = await app.inject({
      method: 'GET',
      url: '/diagnostics/whoami',
      headers: { authorization: 'Bearer diagnostic-secret-value' },
    })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('accepts requests with a valid INTERNAL_API_SECRET bearer token (asymmetric compatibility)', async () => {
    const app = buildTestApp({
      diagnosticApiSecret: 'diagnostic-secret-value',
      internalApiSecret: 'internal-secret-value',
      nodeEnv: 'production',
    })
    const response = await app.inject({
      method: 'GET',
      url: '/diagnostics/whoami',
      headers: { authorization: 'Bearer internal-secret-value' },
    })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('allows unauthenticated access in non-production when no secret is configured', async () => {
    const app = buildTestApp({
      diagnosticApiSecret: undefined,
      internalApiSecret: undefined,
      nodeEnv: 'development',
    })
    const response = await app.inject({ method: 'GET', url: '/diagnostics/whoami' })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('still requires a bearer token in development when a secret is configured', async () => {
    const app = buildTestApp({
      diagnosticApiSecret: 'dev-secret',
      internalApiSecret: undefined,
      nodeEnv: 'development',
    })
    const response = await app.inject({ method: 'GET', url: '/diagnostics/whoami' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })
})
