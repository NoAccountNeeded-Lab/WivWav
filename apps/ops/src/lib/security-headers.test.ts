import { describe, expect, it } from 'vitest'
import { SECURITY_HEADERS, getSecurityHeadersConfig } from './security-headers'

function findHeader(key: string): string | undefined {
  return SECURITY_HEADERS.find((h) => h.key === key)?.value
}

describe('security headers', () => {
  it('sets a same-origin Content-Security-Policy with frame-ancestors none', () => {
    const csp = findHeader('Content-Security-Policy')
    expect(csp).toBeDefined()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('sets X-Frame-Options: DENY', () => {
    expect(findHeader('X-Frame-Options')).toBe('DENY')
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(findHeader('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sets a Referrer-Policy', () => {
    expect(findHeader('Referrer-Policy')).toBe('no-referrer')
  })

  it('applies the header set to every route via getSecurityHeadersConfig', () => {
    const config = getSecurityHeadersConfig()
    expect(config).toHaveLength(1)
    expect(config[0]?.source).toBe('/(.*)')
    expect(config[0]?.headers).toEqual(SECURITY_HEADERS)
  })
})
