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
  itemId: string
  title: string
}

interface EbaySearchResponse {
  total?: number
  itemSummaries?: EbaySearchItem[]
}

interface EbayItemDetail {
  localizedAspects?: { name: string; value: string }[]
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

async function getItemAspects(itemId: string): Promise<Record<string, string>> {
  const token = await getAccessToken()
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) return {}
  const body = (await res.json()) as EbayItemDetail
  const aspects: Record<string, string> = {}
  for (const a of body.localizedAspects ?? []) aspects[a.name] = a.value
  return aspects
}

/** True if either the title or the item's actual getItem aspects indicate a WAV listing. */
function isVerifiedRelevant(title: string, aspects: Record<string, string>): boolean {
  if (WAV_RELEVANCE_PATTERN.test(title)) return true
  if ((aspects['Disability Equipped'] ?? '').toUpperCase() === 'YES') return true
  if (WAV_RELEVANCE_PATTERN.test(aspects['Features'] ?? '')) return true
  return false
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

  // ─── Candidate keyword discovery ─────────────────────────────────────────
  //
  // This is how we answer "what should we be searching for" rather than just
  // "did the keywords we already picked keep working" — the test above.
  //
  // Candidates beyond SEARCH_KEYWORDS are conversion-brand names already
  // used as the WAV-manufacturer vocabulary elsewhere in this package (see
  // inferConversionManufacturer in mobility-van-sales.ts/ams-vans-
  // classifieds.ts) — sellers of a converted van routinely name the
  // conversion brand, which should be a higher-precision signal than a
  // generic phrase — plus a few generic phrasings not yet tried.
  //
  // Relevance here is aspect-verified (via getItem on a small sample), not
  // title-only — see isVerifiedRelevant's doc comment for why title text
  // alone understates true relevance.
  //
  // This block intentionally has no pass/fail assertion on any individual
  // keyword (a brand name can legitimately have low recall and still be
  // worth keeping for its precision). Read the printed table and use it to
  // decide SEARCH_KEYWORDS's contents by hand.
  //
  // Round 1 (2026-10-02) already promoted 'handicap van', 'disability van',
  // and 'braunability' into SEARCH_KEYWORDS (see its own comment for the
  // numbers) — they're excluded here to avoid double-listing. 'rollx vans'
  // and 'driverge' returned zero results as exact phrases and were dropped;
  // a looser phrasing (just 'rollx', just 'driverge') is worth a future
  // round if this list is revisited. 'vantage mobility' is kept below: low
  // recall (5) wasn't enough to promote it, but it's cheap to keep
  // re-checking in case that changes.
  const CANDIDATE_ADDITIONS = [
    'vantage mobility',
    'wheelchair lift van',
  ] as const

  const CANDIDATE_SAMPLE_SIZE = 3

  it(
    'reports recall and aspect-verified relevance for current + candidate keywords',
    async () => {
      const allCandidates = [...SEARCH_KEYWORDS, ...CANDIDATE_ADDITIONS]
      const rows: Array<{
        keyword: string
        inProductionList: boolean
        total: number
        sampleVerifiedRelevant: string
      }> = []

      for (const keyword of allCandidates) {
        const response = await searchKeyword(keyword)
        const items = (response.itemSummaries ?? []).slice(0, CANDIDATE_SAMPLE_SIZE)

        let verifiedCount = 0
        for (const item of items) {
          const aspects = await getItemAspects(item.itemId)
          if (isVerifiedRelevant(item.title, aspects)) verifiedCount += 1
        }

        rows.push({
          keyword,
          inProductionList: (SEARCH_KEYWORDS as readonly string[]).includes(keyword),
          total: response.total ?? 0,
          sampleVerifiedRelevant: items.length > 0 ? `${verifiedCount}/${items.length}` : 'no results',
        })
      }

      console.table(rows)

      // Weak sanity check only — this suite's job is to inform a human
      // decision about SEARCH_KEYWORDS, not to gate CI on any one
      // candidate's numbers.
      expect(rows.length).toBe(allCandidates.length)
    },
    120_000,
  )
})
