import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { diagnosticContextRoutes } from './context.js'

function buildTestApp(gitSha = 'abc123', nodeEnv = 'production') {
  const app = Fastify()
  void app.register(diagnosticContextRoutes, { gitSha, nodeEnv })
  return app
}

describe('GET /', () => {
  it('returns static content plus live revision metadata', async () => {
    const app = buildTestApp('deadbeef', 'production')
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      data: {
        contentVersion: number
        revision: { gitSha: string; nodeEnv: string }
        serviceGlossary: unknown[]
        signalGlossary: unknown[]
        runbookIndex: unknown[]
        safetyRules: string[]
        responseProtocol: { fields: Record<string, string> }
      }
    }
    expect(body.data.revision).toEqual({ gitSha: 'deadbeef', nodeEnv: 'production' })
    expect(body.data.serviceGlossary.length).toBeGreaterThan(0)
    expect(body.data.signalGlossary.length).toBeGreaterThan(0)
    expect(body.data.runbookIndex.length).toBeGreaterThan(0)
    expect(body.data.safetyRules.length).toBeGreaterThan(0)
    expect(body.data.responseProtocol.fields).toHaveProperty('facts')
    expect(body.data.responseProtocol.fields).toHaveProperty('hypotheses')
    expect(body.data.responseProtocol.fields).toHaveProperty('unknowns')
    expect(body.data.responseProtocol.fields).toHaveProperty('nextChecks')

    await app.close()
  })

  it('returns byte-identical static content across two calls (no system-state dependence)', async () => {
    const app = buildTestApp()
    const first = await app.inject({ method: 'GET', url: '/' })
    const second = await app.inject({ method: 'GET', url: '/' })

    expect(first.body).toBe(second.body)

    await app.close()
  })

  it('never includes a planted secret-shaped value', async () => {
    const app = buildTestApp('sk-live-should-never-leak')
    const res = await app.inject({ method: 'GET', url: '/' })
    // The gitSha itself is expected to appear (it's the one deliberately
    // dynamic field) — this test instead confirms nothing else on the
    // response accidentally echoes credential-shaped content by checking the
    // static portion alone stays constant regardless of gitSha.
    const staticApp = buildTestApp('harmless-sha')
    const staticRes = await staticApp.inject({ method: 'GET', url: '/' })
    const bodyWithoutRevision = (res.json() as { data: Record<string, unknown> }).data
    const staticBodyWithoutRevision = (staticRes.json() as { data: Record<string, unknown> }).data
    delete bodyWithoutRevision.revision
    delete staticBodyWithoutRevision.revision
    expect(bodyWithoutRevision).toEqual(staticBodyWithoutRevision)

    await app.close()
    await staticApp.close()
  })
})
