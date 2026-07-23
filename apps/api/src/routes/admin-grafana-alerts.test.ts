import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminGrafanaAlertsRoutes } from './admin-grafana-alerts.js'

const GRAFANA_URL = 'http://grafana.test'

function buildTestApp() {
  const app = Fastify()
  void app.register(adminGrafanaAlertsRoutes, { grafanaUrl: GRAFANA_URL, grafanaApiToken: undefined })
  return app
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('GET /', () => {
  it('returns normalised alert instances for active/pending alerts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      {
        labels: { alertname: 'API target down', __alert_rule_uid__: 'wivwav-api-down', severity: 'critical' },
        annotations: { summary: 'API is unreachable' },
        status: { state: 'active' },
        startsAt: '2026-06-18T17:30:00.000Z',
      },
      {
        labels: { alertname: 'Queue depth high', severity: 'warning' },
        annotations: {},
        status: { state: 'suppressed' },
        startsAt: '2026-06-18T17:45:00.000Z',
      },
    ])))

    const app = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    const { data } = res.json() as { data: { alerts: unknown[]; unavailable: boolean } }
    expect(data.unavailable).toBe(false)
    expect(data.alerts).toEqual([
      { ruleUid: 'wivwav-api-down', alertname: 'API target down', state: 'alerting', severity: 'critical', summary: 'API is unreachable', activeAt: '2026-06-18T17:30:00.000Z' },
      { ruleUid: null, alertname: 'Queue depth high', state: 'pending', severity: 'warning', summary: null, activeAt: '2026-06-18T17:45:00.000Z' },
    ])
  })

  it('returns unavailable:true with an empty list instead of throwing when Grafana is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    }))

    const app = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { alerts: [], unavailable: true } })
  })

  it('returns unavailable:true when Grafana responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))

    const app = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { alerts: [], unavailable: true } })
  })
})
