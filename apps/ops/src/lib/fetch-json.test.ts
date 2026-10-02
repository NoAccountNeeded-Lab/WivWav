import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from './fetch-json'

function stubFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

describe('fetchJson', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('unwraps the { data } envelope', async () => {
    stubFetch(async () => new Response(JSON.stringify({ data: { a: 1 } })))
    expect(await fetchJson<{ a: number }>('http://x')).toEqual({ data: { a: 1 } })
  })

  it('returns a bare body when there is no envelope', async () => {
    stubFetch(async () => new Response(JSON.stringify([1, 2])))
    expect(await fetchJson<number[]>('http://x')).toEqual({ data: [1, 2] })
  })

  it('returns a null body as-is', async () => {
    stubFetch(async () => new Response('null'))
    expect(await fetchJson('http://x')).toEqual({ data: null })
  })

  it('reports non-2xx statuses', async () => {
    stubFetch(async () => new Response('nope', { status: 503 }))
    expect(await fetchJson('http://x')).toEqual({ data: null, error: 'API returned 503' })
  })

  it('reports network errors by message', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(await fetchJson('http://x')).toEqual({ data: null, error: 'ECONNREFUSED' })
  })

  it('reports non-Error rejections generically', async () => {
    stubFetch(async () => {
      throw 'boom'
    })
    expect(await fetchJson('http://x')).toEqual({ data: null, error: 'Request failed' })
  })

  it('reports aborts as timeouts', async () => {
    stubFetch(async () => {
      throw new DOMException('aborted', 'AbortError')
    })
    expect(await fetchJson('http://x')).toEqual({ data: null, error: 'Request timed out' })
  })

  it('forwards init (e.g. POST body) to fetch', async () => {
    stubFetch(async () => new Response('{}'))
    await fetchJson('http://x', 1000, { method: 'POST', body: '{}' })
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.cache).toBe('no-store')
  })
})
