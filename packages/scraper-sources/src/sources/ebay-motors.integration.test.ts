import { describe, it, expect, beforeAll } from 'vitest'
import { MOTORS_CATEGORY_ID, SEARCH_KEYWORDS } from './ebay-motors.js'

// Integration tests — hit the real eBay Browse API (production host only;
// the stored production credentials 401 against the sandbox host, so there
// is nothing meaningful to test there). Gated on two things, both opt-in:
//
//   WIVWAV_LIVE_SCRAPER_TESTS=1   — this repo's standard live-network gate
//   EBAY_MOTORS_APP_ID / EBAY_MOTORS_CERT_ID — real eBay Developer Program
//     credentials. packages/scraper-sources must not depend on @wivwav/db,
//     so these come from env vars here rather than ConfigService.
//
// Run: WIVWAV_LIVE_SCRAPER_TESTS=1 EBAY_MOTORS_APP_ID=... EBAY_MOTORS_CERT_ID=... \
//   pnpm --filter @wivwav/scraper-sources test:integration
//
// What this checks, per keyword in SEARCH_KEYWORDS: that the keyword finds
// something (recall) and that most of what it finds actually looks like a
// WAV listing (precision) — catching a keyword that's gone too broad (e.g.
// a short/generic term starting to pull in unrelated Cars & Trucks
// inventory) before it ships, the same question the manual
// /ops/ebay-motors-search tool answers interactively for one keyword at a
// time (#999).

const liveNetwork = process.env['WIVWAV_LIVE_SCRAPER_TESTS'] === '1'
const appId = process.env['EBAY_MOTORS_APP_ID']
const certId = process.env['EBAY_MOTORS_CERT_ID']
const hasCredentials = Boolean(appId && certId)

const REQUEST_TIMEOUT_MS = 15_000
const SEARCH_LIMIT = 10
// A result doesn't need every one of these terms — just enough overlap with
// how sellers actually describe a WAV to distinguish it from an arbitrary
// Cars & Trucks listing a too-broad keyword could start pulling in.
const WAV_RELEVANCE_PATTERN = /wheelchair|handicap|accessible|mobility|\bwav\b|ramp|disab/i
// Live-verified 2026-10 (#999): eBay's `q` search matches the full listing
// (description/aspects), not just the title — a 100%-legitimate WAV result
// can have a generic title like "2008 Chevrolet Express LS" with the actual
// "wheelchair"/"ramp" wording only in its description. Observed real
// fractions for genuinely good keywords ran 50-60%, not the ~100% a
// title-only heuristic would suggest. This floor is therefore a "something
// is badly wrong" tripwire (a keyword gone so generic it's barely
// distinguishable from random Cars & Trucks inventory), not a precision
// target — don't raise it based on title text alone without re-verifying
// against each item's actual description/aspects via getItem.
const MIN_RELEVANT_FRACTION = 0.3

interface EbaySearchItem {
  title: string
}

interface EbaySearchResponse {
  total?: number
  itemSummaries?: EbaySearchItem[]
}

let cachedToken: string | null = null

async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken
  const basic = Buffer.from(`${appId}:${certId}`).toString('base64')
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`)
  }
  const body = (await res.json()) as { access_token: string }
  cachedToken = body.access_token
  return cachedToken
}

async function searchKeyword(keyword: string): Promise<EbaySearchResponse> {
  const token = await getAccessToken()
  const params = new URLSearchParams({ q: keyword, category_ids: MOTORS_CATEGORY_ID, limit: String(SEARCH_LIMIT) })
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`search failed for "${keyword}": ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as EbaySearchResponse
}

describe.skipIf(!liveNetwork || !hasCredentials)('eBay Motors search keywords — live Browse API', () => {
  beforeAll(() => {
    if (liveNetwork && !hasCredentials) {
      throw new Error(
        'WIVWAV_LIVE_SCRAPER_TESTS=1 but EBAY_MOTORS_APP_ID/EBAY_MOTORS_CERT_ID are not set — set both, or unset WIVWAV_LIVE_SCRAPER_TESTS to skip this suite.',
      )
    }
  })

  it.each(SEARCH_KEYWORDS)('"%s" finds relevant, WAV-like results', async (keyword) => {
    const response = await searchKeyword(keyword)
    const items = response.itemSummaries ?? []

    expect(response.total ?? 0).toBeGreaterThan(0)
    expect(items.length).toBeGreaterThan(0)

    const relevantCount = items.filter((item) => WAV_RELEVANCE_PATTERN.test(item.title)).length
    const relevantFraction = relevantCount / items.length

    expect(
      relevantFraction,
      `keyword "${keyword}": only ${relevantCount}/${items.length} titles looked WAV-relevant — ` +
        `titles were: ${items.map((i) => i.title).join(' | ')}`,
    ).toBeGreaterThanOrEqual(MIN_RELEVANT_FRACTION)
  }, 30_000)
})
