import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicApiBaseUrl, getServerApiBaseUrl } from './server-api-url'

afterEach(() => vi.unstubAllEnvs())

describe('server API URL configuration', () => {
  it.each([undefined, '', '   '])('uses the local default for an unset or blank public URL (%s)', (value) => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', value)
    vi.stubEnv('API_INTERNAL_URL', undefined)
    expect(getPublicApiBaseUrl()).toBe('http://localhost:4001')
    expect(getServerApiBaseUrl()).toBe('http://localhost:4001')
  })

  it('reads the deployment URL on each call without exposing the internal URL', () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api:3001')
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.first.example')
    expect(getPublicApiBaseUrl()).toBe('https://api.first.example')
    expect(getServerApiBaseUrl()).toBe('http://api:3001')
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.second.example')
    expect(getPublicApiBaseUrl()).toBe('https://api.second.example')
  })

  it.each([undefined, '', '   '])('falls back to the public URL when the internal URL is unset or blank (%s)', (value) => {
    vi.stubEnv('API_INTERNAL_URL', value)
    vi.stubEnv('NEXT_PUBLIC_API_URL', '  https://api.example  ')
    expect(getServerApiBaseUrl()).toBe('https://api.example')
    expect(getPublicApiBaseUrl()).toBe('https://api.example')
  })
})
