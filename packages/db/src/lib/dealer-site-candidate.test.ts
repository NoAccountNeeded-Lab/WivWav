import { describe, expect, it } from 'vitest'
import { normalizeDealerSiteOrigin } from './dealer-site-candidate.js'

describe('normalizeDealerSiteOrigin', () => {
  it('collapses scheme, www, case, path, query and fragment to one origin', () => {
    const expected = 'https://dealer.com'
    expect(normalizeDealerSiteOrigin('https://www.Dealer.com/inventory?x=1#top')).toBe(expected)
    expect(normalizeDealerSiteOrigin('http://dealer.com/')).toBe(expected)
    expect(normalizeDealerSiteOrigin('  dealer.com:8080/a  ')).toBe(expected)
    expect(normalizeDealerSiteOrigin('https://DEALER.com.')).toBe(expected)
  })

  it('keeps meaningful subdomains', () => {
    expect(normalizeDealerSiteOrigin('https://vans.dealer.com/x')).toBe('https://vans.dealer.com')
  })

  it.each([
    ['facebook', 'https://www.facebook.com/somedealer'],
    ['facebook subdomain', 'https://m.facebook.com/x'],
    ['linktr.ee', 'https://linktr.ee/dealer'],
    ['registered source blvd', 'https://www.blvd.com/dealer/1'],
    ['registered source mobilityworks', 'https://mobilityworks.com'],
    ['ipv4', 'http://192.168.1.10/inv'],
    ['ipv6', 'http://[::1]/'],
    ['single label', 'http://localhost/'],
    ['non-http scheme', 'ftp://dealer.com/'],
    ['mailto', 'mailto:a@dealer.com'],
    ['garbage', 'http://'],
    ['empty', '   '],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeDealerSiteOrigin(raw)).toBeNull()
  })

  it('does not reject lookalike hosts', () => {
    expect(normalizeDealerSiteOrigin('https://notfacebook.com')).toBe('https://notfacebook.com')
  })

  it('returns null for null and undefined', () => {
    expect(normalizeDealerSiteOrigin(null)).toBeNull()
    expect(normalizeDealerSiteOrigin(undefined)).toBeNull()
  })
})
