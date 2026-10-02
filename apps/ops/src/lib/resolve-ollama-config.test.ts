import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('./api-fetch', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('./api-url', () => ({ getServerApiBaseUrl: () => 'http://api' }))

import {
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_MODEL,
  resolveOllamaConfig,
} from './resolve-ollama-config'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

describe('resolveOllamaConfig', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    vi.stubEnv('OLLAMA_BASE_URL', undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('uses the configured model and encodes the key', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ data: { value: 'qwen3' } }))
    const result = await resolveOllamaConfig('ollama/model key')
    expect(result).toEqual({ model: 'qwen3', baseUrl: OLLAMA_DEFAULT_BASE_URL })
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe('http://api/admin/config/ollama%2Fmodel%20key')
  })

  it('honours OLLAMA_BASE_URL', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', 'http://ollama:11434')
    apiFetchMock.mockResolvedValue(jsonResponse({ data: { value: 'm' } }))
    expect((await resolveOllamaConfig('k')).baseUrl).toBe('http://ollama:11434')
  })

  it('falls back to the default model for a non-string value', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ data: { value: 42 } }))
    expect((await resolveOllamaConfig('k')).model).toBe(OLLAMA_DEFAULT_MODEL)
  })

  it('falls back to the default model on a non-ok response', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({}, false))
    expect((await resolveOllamaConfig('k')).model).toBe(OLLAMA_DEFAULT_MODEL)
  })

  it('falls back to the default model when the request throws', async () => {
    apiFetchMock.mockRejectedValue(new Error('network down'))
    expect(await resolveOllamaConfig('k')).toEqual({
      model: OLLAMA_DEFAULT_MODEL,
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
    })
  })
})
