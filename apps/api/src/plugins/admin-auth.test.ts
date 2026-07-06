import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { adminAuthPlugin } from './admin-auth.js'

function buildTestApp(opts: { internalApiSecret: string | undefined; nodeEnv: 'development' | 'test' | 'production' }) {
  const app = Fastify()
  void app.register(
    async (adminScope) => {
      await adminAuthPlugin(adminScope, opts)
      adminScope.get('/whoami', async () => ({ data: 'ok' }))
    },
    { prefix: '/admin' },
  )
  return app
}

describe('adminAuthPlugin', () => {
  it('fails closed in production with no secret configured', async () => {
    const app = buildTestApp({ internalApiSecret: undefined, nodeEnv: 'production' })
    const response = await app.inject({ method: 'GET', url: '/admin/whoami' })
    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).error.code).toBe('ADMIN_DISABLED')
    await app.close()
  })

  it('rejects requests without a valid bearer token when a secret is configured', async () => {
    const app = buildTestApp({ internalApiSecret: 'super-secret-value', nodeEnv: 'production' })
    const response = await app.inject({ method: 'GET', url: '/admin/whoami' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects requests with an incorrect bearer token', async () => {
    const app = buildTestApp({ internalApiSecret: 'super-secret-value', nodeEnv: 'production' })
    const response = await app.inject({
      method: 'GET',
      url: '/admin/whoami',
      headers: { authorization: 'Bearer wrong-value' },
    })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('accepts requests with a valid bearer token', async () => {
    const app = buildTestApp({ internalApiSecret: 'super-secret-value', nodeEnv: 'production' })
    const response = await app.inject({
      method: 'GET',
      url: '/admin/whoami',
      headers: { authorization: 'Bearer super-secret-value' },
    })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('allows unauthenticated access in non-production when no secret is configured', async () => {
    const app = buildTestApp({ internalApiSecret: undefined, nodeEnv: 'development' })
    const response = await app.inject({ method: 'GET', url: '/admin/whoami' })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('still requires the bearer token in development when a secret is configured', async () => {
    const app = buildTestApp({ internalApiSecret: 'dev-secret', nodeEnv: 'development' })
    const response = await app.inject({ method: 'GET', url: '/admin/whoami' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })
})
