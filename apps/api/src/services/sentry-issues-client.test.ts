import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSentryIssues } from './sentry-issues-client.js'

const creds = { sentryAuthToken: 'tok', sentryOrg: 'org', sentryProject: 'proj' }
const UNAVAILABLE = { issues: [], unavailable: true }

function stubFetch(impl: () => Promise<unknown>) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('fetchSentryIssues', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    { ...creds, sentryAuthToken: undefined },
    { ...creds, sentryOrg: undefined },
    { ...creds, sentryProject: undefined },
  ])('is unavailable without full credentials, without calling fetch', async (opts) => {
    const mock = stubFetch(async () => new Response('[]'))
    expect(await fetchSentryIssues(opts)).toEqual(UNAVAILABLE)
    expect(mock).not.toHaveBeenCalled()
  })

  it('maps issues and sends the bearer token to the project endpoint', async () => {
    const mock = stubFetch(
      async () =>
        new Response(
          JSON.stringify([
            { id: '1', title: 'Boom', culprit: null, level: 'error', count: '42', firstSeen: 'a', lastSeen: 'b', permalink: 'https://s/1' },
          ]),
        ),
    )
    const result = await fetchSentryIssues(creds)
    expect(result).toEqual({
      unavailable: false,
      issues: [{ id: '1', title: 'Boom', culprit: null, level: 'error', count: 42, firstSeen: 'a', lastSeen: 'b', permalink: 'https://s/1' }],
    })
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://sentry.io/api/0/projects/org/proj/issues/?')
    expect(url).toContain('query=is%3Aunresolved')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('is unavailable on network error, non-2xx, bad JSON, or a non-array body', async () => {
    stubFetch(async () => {
      throw new Error('down')
    })
    expect(await fetchSentryIssues(creds)).toEqual(UNAVAILABLE)

    stubFetch(async () => new Response('x', { status: 500 }))
    expect(await fetchSentryIssues(creds)).toEqual(UNAVAILABLE)

    stubFetch(async () => new Response('not json'))
    expect(await fetchSentryIssues(creds)).toEqual(UNAVAILABLE)

    stubFetch(async () => new Response('{"detail":"x"}'))
    expect(await fetchSentryIssues(creds)).toEqual(UNAVAILABLE)
  })
})
