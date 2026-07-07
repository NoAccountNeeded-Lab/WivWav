import { describe, it, expect } from 'vitest'
import { isRequestOverHttps } from './route'

describe('isRequestOverHttps', () => {
  it('trusts X-Forwarded-Proto: https from the reverse proxy', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'https' })
    expect(isRequestOverHttps(headers, 'http://localhost:3002/api/login')).toBe(true)
  })

  it('trusts X-Forwarded-Proto: http even when NODE_ENV would say production', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'http' })
    expect(isRequestOverHttps(headers, 'http://localhost:3002/api/login')).toBe(false)
  })

  it('takes the first value when X-Forwarded-Proto is a comma-separated chain', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'https, http' })
    expect(isRequestOverHttps(headers, 'http://localhost:3002/api/login')).toBe(true)
  })

  it('falls back to the request URL scheme when there is no proxy header', () => {
    const headers = new Headers()
    expect(isRequestOverHttps(headers, 'http://localhost:3002/api/login')).toBe(false)
    expect(isRequestOverHttps(headers, 'https://ops.example.com/api/login')).toBe(true)
  })
})
