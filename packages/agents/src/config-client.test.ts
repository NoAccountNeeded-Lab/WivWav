import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAgentConfig } from './config-client.js'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('operator config client', () => {
  it.each(['', '/decrypt'] as const)('uses operator identity for config reads %s', async suffix => {
    vi.stubEnv('CONFIG_API_URL', 'http://api.private')
    vi.stubEnv('OPS_API_SECRET', 'operator-secret')
    const fetchMock = vi.fn(async () => Response.json({ data: { value: 'result' } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAgentConfig('ai.model/key', suffix)).toBe('result')
    expect(fetchMock).toHaveBeenCalledWith(`http://api.private/internal/ops/config/ai.model%2Fkey${suffix}`, {
      headers: { Authorization: 'Bearer operator-secret' }, redirect: 'error',
    })
  })

  it('does not fall back to web identity when operator credentials are missing', async () => {
    vi.stubEnv('CONFIG_API_URL', 'http://api.private')
    vi.stubEnv('OPS_API_SECRET', '')
    vi.stubEnv('INTERNAL_API_SECRET', 'web-secret')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAgentConfig('ai.model')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([new Response(null, { status: 401 }), Response.json({ data: { value: 4 } }), Response.json({})])('fails safely on rejected or malformed config response', async response => {
    vi.stubEnv('CONFIG_API_URL', 'http://api.private')
    vi.stubEnv('OPS_API_SECRET', 'operator-secret')
    vi.stubGlobal('fetch', vi.fn(async () => response))
    expect(await fetchAgentConfig('ai.model')).toBeNull()
  })

  it('fails safely on network or redirect errors', async () => {
    vi.stubEnv('CONFIG_API_URL', 'http://api.private')
    vi.stubEnv('OPS_API_SECRET', 'operator-secret')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network failed') }))
    expect(await fetchAgentConfig('ai.model')).toBeNull()
  })
})
