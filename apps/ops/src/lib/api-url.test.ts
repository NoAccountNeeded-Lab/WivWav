import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicApiBaseUrl, getServerApiBaseUrl } from './api-url'

describe('getServerApiBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers API_INTERNAL_URL', () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api:4001')
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example')
    expect(getServerApiBaseUrl()).toBe('http://api:4001')
  })

  it('falls back to NEXT_PUBLIC_API_URL', () => {
    vi.stubEnv('API_INTERNAL_URL', undefined)
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example')
    expect(getServerApiBaseUrl()).toBe('https://public.example')
  })

  it('falls back to localhost when nothing is set', () => {
    vi.stubEnv('API_INTERNAL_URL', undefined)
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined)
    expect(getServerApiBaseUrl()).toBe('http://localhost:4001')
  })
})

describe('getPublicApiBaseUrl', () => {
  it('is always the same-origin BFF path', () => {
    expect(getPublicApiBaseUrl()).toBe('/api/bff')
  })
})
