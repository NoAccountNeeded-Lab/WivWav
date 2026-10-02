import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchGrafanaAlerts } from './grafana-alerts-client.js'

const UNAVAILABLE = { alerts: [], unavailable: true }

function stubFetch(impl: () => Promise<unknown>) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('fetchGrafanaAlerts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps alertmanager alerts, translating states and defaulting missing fields', async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify([
            {
              labels: { __alert_rule_uid__: 'uid1', alertname: 'HighErrors', severity: 'critical' },
              annotations: { summary: 'Errors up' },
              status: { state: 'active' },
              startsAt: '2026-01-01T00:00:00Z',
            },
            { status: { state: 'suppressed' } },
            { labels: { alertname: 'X' }, status: { state: 'unprocessed' } },
            {},
          ]),
        ),
    )
    const { alerts, unavailable } = await fetchGrafanaAlerts({ grafanaUrl: 'http://g', grafanaApiToken: undefined })
    expect(unavailable).toBe(false)
    expect(alerts).toEqual([
      { ruleUid: 'uid1', alertname: 'HighErrors', state: 'alerting', severity: 'critical', summary: 'Errors up', activeAt: '2026-01-01T00:00:00Z' },
      { ruleUid: null, alertname: 'unknown', state: 'pending', severity: null, summary: null, activeAt: null },
      { ruleUid: null, alertname: 'X', state: 'unprocessed', severity: null, summary: null, activeAt: null },
      { ruleUid: null, alertname: 'unknown', state: 'unknown', severity: null, summary: null, activeAt: null },
    ])
  })

  it('calls the active-alerts endpoint, adding auth only when a token is set', async () => {
    const mock = stubFetch(async () => new Response('[]'))
    await fetchGrafanaAlerts({ grafanaUrl: 'http://g', grafanaApiToken: 'tok' })
    await fetchGrafanaAlerts({ grafanaUrl: 'http://g', grafanaApiToken: undefined })
    const [url, withToken] = mock.mock.calls[0] as unknown as [string, RequestInit]
    const [, withoutToken] = mock.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe('http://g/api/alertmanager/grafana/api/v2/alerts?active=true')
    expect(withToken.headers).toEqual({ Authorization: 'Bearer tok' })
    expect(withoutToken.headers).toEqual({})
  })

  it('is unavailable on network error, non-2xx, bad JSON, or a non-array body', async () => {
    const opts = { grafanaUrl: 'http://g', grafanaApiToken: undefined }
    stubFetch(async () => {
      throw new Error('down')
    })
    expect(await fetchGrafanaAlerts(opts)).toEqual(UNAVAILABLE)
    stubFetch(async () => new Response('x', { status: 502 }))
    expect(await fetchGrafanaAlerts(opts)).toEqual(UNAVAILABLE)
    stubFetch(async () => new Response('nope'))
    expect(await fetchGrafanaAlerts(opts)).toEqual(UNAVAILABLE)
    stubFetch(async () => new Response('{}'))
    expect(await fetchGrafanaAlerts(opts)).toEqual(UNAVAILABLE)
  })
})
