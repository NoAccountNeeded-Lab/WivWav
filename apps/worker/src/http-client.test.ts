import { describe, expect, it, vi } from 'vitest'
import { HttpClient, HttpRequestError } from './http-client.js'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('HttpClient', () => {
  it('sends a bearer token and JSON body, unwrapping { data }', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' })
      expect(JSON.parse(init?.body as string)).toEqual({ sourceId: 's1' })
      return jsonResponse(200, { data: { id: 'run-1' } })
    })
    const client = new HttpClient({ baseUrl: 'http://api:3001', token: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch })
    const result = await client.post<{ id: string }>('/internal/scraper/runs', { sourceId: 's1' })
    expect(result).toEqual({ id: 'run-1' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries on network failure and eventually succeeds', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls < 3) throw new Error('ECONNREFUSED')
      return jsonResponse(200, { data: { ok: true } })
    })
    const client = new HttpClient({
      baseUrl: 'http://api:3001',
      token: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseDelayMs: 1,
    })
    const result = await client.get('/internal/scraper/sources/s1/execution-state')
    expect(result).toEqual({ ok: true })
    expect(calls).toBe(3)
  })

  it('throws after exhausting retries on persistent network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const client = new HttpClient({
      baseUrl: 'http://api:3001',
      token: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
      baseDelayMs: 1,
    })
    await expect(client.get('/x')).rejects.toThrow(/failed after 2 attempts/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not retry an application-level 4xx and throws HttpRequestError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: { code: 'not_found', message: 'nope' } }))
    const client = new HttpClient({ baseUrl: 'http://api:3001', token: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.get('/x')).rejects.toThrow(HttpRequestError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
