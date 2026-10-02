import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('./api-fetch', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('./api-url', () => ({ getServerApiBaseUrl: () => 'http://api' }))

import { resolveEbayCredentials } from './resolve-ebay-credentials'

function res(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

function mockByUrl(map: Record<string, Response>) {
  apiFetchMock.mockImplementation(async (url: string) => map[url] ?? res({}, false))
}

const APP = 'http://api/admin/config/ebay.motors.app-id/decrypt'
const CERT = 'http://api/admin/config/ebay.motors.cert-id/decrypt'
const ENV = 'http://api/admin/config/ebay.motors.environment'

describe('resolveEbayCredentials', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('returns decrypted credentials with the configured environment', async () => {
    mockByUrl({
      [APP]: res({ data: { value: 'app' } }),
      [CERT]: res({ data: { value: 'cert' } }),
      [ENV]: res({ data: { value: 'production' } }),
    })
    expect(await resolveEbayCredentials()).toEqual({
      appId: 'app',
      certId: 'cert',
      environment: 'production',
    })
  })

  it('defaults to sandbox when the environment is missing or unknown', async () => {
    mockByUrl({
      [APP]: res({ data: { value: 'app' } }),
      [CERT]: res({ data: { value: 'cert' } }),
      [ENV]: res({}, false),
    })
    expect((await resolveEbayCredentials())?.environment).toBe('sandbox')

    mockByUrl({
      [APP]: res({ data: { value: 'app' } }),
      [CERT]: res({ data: { value: 'cert' } }),
      [ENV]: res({ data: { value: 'staging' } }),
    })
    expect((await resolveEbayCredentials())?.environment).toBe('sandbox')
  })

  it('returns null when either credential is not configured', async () => {
    mockByUrl({ [APP]: res({}, false), [CERT]: res({ data: { value: 'cert' } }) })
    expect(await resolveEbayCredentials()).toBeNull()

    mockByUrl({ [APP]: res({ data: { value: 'app' } }), [CERT]: res({}, false) })
    expect(await resolveEbayCredentials()).toBeNull()
  })
})
