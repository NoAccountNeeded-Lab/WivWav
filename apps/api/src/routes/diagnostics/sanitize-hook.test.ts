import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it } from 'vitest'
import { addDiagnosticSanitizer } from './sanitize-hook.js'

async function build() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(async (scope) => {
    addDiagnosticSanitizer(scope)
    scope.get('/nf', async (_req, reply) => reply.notFound('No jobId "token=SECRET123 bob@example.com" found'))
    scope.get('/bad', async (_req, reply) => reply.code(400).send({ error: { code: 'X', message: 'api_key=KEY456789' } }))
    scope.get('/throw', async () => {
      throw new Error('db down postgres://u:pw99999@h/db')
    })
    scope.get('/huge', async (_req, reply) => reply.send({ message: 'x'.repeat(1_100_000) + ' token=HUGE123' }))
    scope.get('/stream', async (_req, reply) => reply.type('text/plain').send(Buffer.from('plain text token=RAW123')))
    scope.get('/bin', async (_req, reply) =>
      reply.type('application/octet-stream').send(Buffer.from('token=BIN123 \u0000\u0001', 'latin1')),
    )
  })
  return app
}

describe('addDiagnosticSanitizer', () => {
  it('sanitizes 404 envelopes that echo the requested id', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/nf' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toMatch(/SECRET123|bob@example\.com/)
    await app.close()
  })

  it('sanitizes explicit error replies and thrown errors', async () => {
    const app = await build()
    const bad = await app.inject({ method: 'GET', url: '/bad' })
    expect(bad.statusCode).toBe(400)
    expect(bad.body).not.toContain('KEY456789')
    const thrown = await app.inject({ method: 'GET', url: '/throw' })
    expect(thrown.statusCode).toBe(500)
    expect(thrown.body).not.toContain('pw99999')
    await app.close()
  })

  it('sanitizes non-JSON text payloads', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/stream' })
    expect(res.body).not.toContain('RAW123')
    await app.close()
  })

  it('fails closed for binary content types instead of decoding them as UTF-8', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/bin' })
    expect(res.body).not.toContain('BIN123')
    expect(res.json()).toEqual({ error: { code: 'DIAGNOSTIC_UNSANITIZABLE', message: 'Response could not be sanitized' } })
    await app.close()
  })

  it('fails closed for oversize payloads before parsing', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/huge' })
    expect(res.body).not.toContain('HUGE123')
    expect(res.json()).toEqual({ error: { code: 'DIAGNOSTIC_UNSANITIZABLE', message: 'Response could not be sanitized' } })
    await app.close()
  })
})
