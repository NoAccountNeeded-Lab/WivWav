import { describe, expect, it } from 'vitest'
import { SECURITY_HEADERS, getSecurityHeaders, getSecurityHeadersConfig } from './security-headers'

function findHeader(key: string, headers = SECURITY_HEADERS): string | undefined {
  return headers.find((h) => h.key === key)?.value
}

describe('security headers', () => {
  it('sets a same-origin Content-Security-Policy with frame-ancestors none', () => {
    const csp = findHeader('Content-Security-Policy')
    expect(csp).toBeDefined()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('allows unsafe-eval only for local development', () => {
    expect(findHeader('Content-Security-Policy', getSecurityHeaders('development'))).toContain("'unsafe-eval'")
    expect(findHeader('Content-Security-Policy', getSecurityHeaders('production'))).not.toContain("'unsafe-eval'")
    expect(findHeader('Content-Security-Policy', getSecurityHeaders('test'))).not.toContain("'unsafe-eval'")
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
    const config = getSecurityHeadersConfig('production')
    expect(config).toHaveLength(1)
    expect(config[0]?.source).toBe('/(.*)')
    expect(config[0]?.headers).toEqual(SECURITY_HEADERS)
  })

  it('passes the requested environment through getSecurityHeadersConfig', () => {
    const config = getSecurityHeadersConfig('development')
    expect(findHeader('Content-Security-Policy', config[0]?.headers)).toContain("'unsafe-eval'")
  })
})
