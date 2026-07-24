// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getClientApiBaseUrl, getPublicApiBaseUrl, getServerApiBaseUrl } from './api-url'

const ENV_KEYS = ['API_INTERNAL_URL', 'NEXT_PUBLIC_API_URL'] as const

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

describe('getServerApiBaseUrl / getPublicApiBaseUrl — server-side, request-time env reads', () => {
  afterEach(clearEnv)

  it('falls back to the documented default when nothing is set', () => {
    clearEnv()
    expect(getServerApiBaseUrl()).toBe('http://localhost:4001')
    expect(getPublicApiBaseUrl()).toBe('http://localhost:4001')
  })

  it('getPublicApiBaseUrl reflects NEXT_PUBLIC_API_URL at call time (not baked in)', () => {
    clearEnv()
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.wivwav.example'
    expect(getPublicApiBaseUrl()).toBe('https://api.wivwav.example')
  })

  it('getServerApiBaseUrl prefers API_INTERNAL_URL over NEXT_PUBLIC_API_URL', () => {
    clearEnv()
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.wivwav.example'
    process.env['API_INTERNAL_URL'] = 'http://api:4001'
    expect(getServerApiBaseUrl()).toBe('http://api:4001')
  })
})

describe('getClientApiBaseUrl — browser-side, reads the runtime data-api-url attribute', () => {
  beforeEach(() => {
    clearEnv()
  })

  afterEach(() => {
    document.body.removeAttribute('data-api-url')
    clearEnv()
  })

  it('reads the API host RootLayout stamped on <body> at request time', () => {
    document.body.dataset['apiUrl'] = 'https://api.wivwav.example'
    expect(getClientApiBaseUrl()).toBe('https://api.wivwav.example')
  })

  it('falls back to the documented default when data-api-url is absent', () => {
    expect(getClientApiBaseUrl()).toBe('http://localhost:4001')
  })

  it('falls back to the documented default when data-api-url is empty', () => {
    document.body.dataset['apiUrl'] = ''
    expect(getClientApiBaseUrl()).toBe('http://localhost:4001')
  })

  it('never reads NEXT_PUBLIC_API_URL directly — that value is only inlined at build time and cannot vary per deploy in a shared production image (#837)', () => {
    // A build-time value could still be inlined here in a real bundle even
    // though process.env writes at test time obviously can't reproduce that.
    // This test instead locks in the API contract: the client helper's
    // return value must depend only on the DOM attribute, never on
    // process.env, so future edits can't reintroduce the direct read.
    process.env['NEXT_PUBLIC_API_URL'] = 'http://localhost:4001-build-time-baked-in'
    document.body.dataset['apiUrl'] = 'https://api.wivwav.example'
    expect(getClientApiBaseUrl()).toBe('https://api.wivwav.example')
  })
})
