import { describe, expect, it } from 'vitest'
import { checkForBlock } from './bot-detector.js'

describe('checkForBlock', () => {
  it('reports an ordinary 200 page with real content as not blocked', () => {
    const result = checkForBlock(200, '<html><body><div class="listing-card">2019 Dodge</div></body></html>')
    expect(result).toEqual({ blocked: false, reason: null })
  })

  it('reports an ordinary 200 page with zero listings as not blocked (empty results, not a block)', () => {
    const result = checkForBlock(200, '<html><body><p>No listings found.</p></body></html>')
    expect(result).toEqual({ blocked: false, reason: null })
  })

  it.each([403, 429, 503])('reports status %i as blocked', (statusCode) => {
    const result = checkForBlock(statusCode, '<html>whatever</html>')
    expect(result.blocked).toBe(true)
    expect(result.reason).toBe(`status_${statusCode}`)
  })

  it('does not report an ordinary error status (e.g. 404, 500) as blocked', () => {
    expect(checkForBlock(404, '<html>Not Found</html>')).toEqual({ blocked: false, reason: null })
    expect(checkForBlock(500, '<html>Internal Server Error</html>')).toEqual({ blocked: false, reason: null })
  })

  it('detects a Cloudflare challenge page by body content even on a 200', () => {
    const result = checkForBlock(200, '<html><body>Just a moment...<div id="cf-browser-verification"></div></body></html>')
    expect(result).toEqual({ blocked: true, reason: 'cloudflare_challenge' })
  })

  it('detects a PerimeterX challenge page', () => {
    const result = checkForBlock(200, '<script>window._pxhd = "abc";</script>')
    expect(result).toEqual({ blocked: true, reason: 'perimeterx_challenge' })
  })

  it('detects a DataDome challenge page', () => {
    const result = checkForBlock(200, '<html>DataDome protection active</html>')
    expect(result).toEqual({ blocked: true, reason: 'datadome_challenge' })
  })

  it('detects an Incapsula challenge page', () => {
    const result = checkForBlock(200, '<html><!-- _Incapsula_Resource --></html>')
    expect(result).toEqual({ blocked: true, reason: 'incapsula_challenge' })
  })

  it('detects a generic captcha page', () => {
    const result = checkForBlock(200, '<html>Please complete the CAPTCHA to continue</html>')
    expect(result).toEqual({ blocked: true, reason: 'generic_captcha' })
  })

  it('only checks the first few KB of a long body', () => {
    const paddedThenChallenge = `${'x'.repeat(10_000)}Just a moment...`
    expect(checkForBlock(200, paddedThenChallenge)).toEqual({ blocked: false, reason: null })
  })

  it('treats a null statusCode as not blocked by status alone', () => {
    expect(checkForBlock(null, '<html>real content</html>')).toEqual({ blocked: false, reason: null })
  })
})
