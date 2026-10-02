import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let incomingRequestId: string | null = null

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-request-id' ? incomingRequestId : null) }),
}))

import { apiFetch } from './api-fetch'

describe('apiFetch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    incomingRequestId = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function sentHeaders(): Record<string, string> {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    return init.headers as Record<string, string>
  }

  it('forwards the incoming x-request-id', async () => {
    incomingRequestId = 'req-123'
    await apiFetch('http://api/x')
    expect(sentHeaders()['x-request-id']).toBe('req-123')
  })

  it('generates a request id when none is incoming', async () => {
    await apiFetch('http://api/x')
    expect(sentHeaders()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('adds a bearer token when INTERNAL_API_SECRET is set', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 's3cret')
    await apiFetch('http://api/x')
    expect(sentHeaders()['Authorization']).toBe('Bearer s3cret')
  })

  it('omits Authorization without the secret and keeps caller headers/init', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', '')
    await apiFetch('http://api/x', { method: 'POST', headers: { 'x-custom': '1' } })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(sentHeaders()['x-custom']).toBe('1')
    expect(sentHeaders()['Authorization']).toBeUndefined()
  })
})
