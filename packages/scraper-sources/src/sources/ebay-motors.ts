import { createHash } from 'node:crypto'
import type { SourceAdapter, ScrapeResult, StructureCheckResult } from '../engine/source-adapter.js'
import type { Listing } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import { report } from '../jobs/job-progress.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/types'
import { isVehicleImageUrl } from './image-filter.js'
import { parseVehicleTitle } from '../lib/parse-vehicle-title.js'
import type { EbayCredentials } from './factory.js'

const SOURCE_ID = 'ebay-motors'
const PAGE_SIZE = 200
// Hard cap on unique items discovered per scrape() run. Each discovered item
// costs one getItem call on top of the handful of search-page calls
// (VIN/mileage/seller-type/city-state live only on getItem — see
// buildListing's doc comment). eBay's default Browse API quota is 5,000
// calls/day (confirmed via the developer portal, 2026-10-01; track actual
// usage with the Developer Analytics API's rate_limit resource, and request
// an increase via the Application Growth Check if this is ever raised).
// This source's cron (source-registry.ts) runs 4x/day, so 700 here budgets
// ~2,800 getItem calls/day plus a small constant for search pagination —
// comfortably under half the daily quota, leaving headroom for 429 retries
// and any other Browse API usage sharing the same app. Revisit this number
// together with the cron frequency if either changes.
const MAX_ITEMS_PER_RUN = 700
const REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_PAGE_DELAY_MS = 500
const DEFAULT_DETAIL_DELAY_MS = 300
// eBay Motors has no dedicated "wheelchair accessible van" category — the
// Cars & Trucks category is combined with keyword search across the common
// ways sellers describe a WAV. Verified 2026-10-01: category_ids=6001 +
// q="wheelchair van" surfaces genuine WAV listings (e.g. a "AM General
// MOBILITY VENTURES WHEELCHAIR VAN VPG MV-1" with
// localizedAspects["Disability Equipped"] = "YES") rather than parts/
// accessories, against a live production Browse API response (#999).
// Exported so ebay-motors.integration.test.ts can exercise the real search
// endpoint per keyword against the single source of truth, rather than a
// second hardcoded copy that could silently drift from what actually ships.
export const MOTORS_CATEGORY_ID = '6001'
// Keyword recall/precision as measured by ebay-motors.integration.test.ts's
// discovery block against a live production response, 2026-10-02 (sample
// size 3, aspect-verified via getItem, not title-only):
//   wheelchair van             total=119  1/3 verified
//   wheelchair accessible van  total=24   3/3 verified
//   handicap accessible van    total=19   3/3 verified
//   mobility van conversion    total=2    1/2 verified  (weak recall, kept — low cost)
//   wav                        total=8    3/3 verified
//   handicap van               total=137  1/3 verified  (highest recall of any keyword tried)
//   disability van             total=136  3/3 verified  (high recall AND high precision)
//   braunability               total=30   2/3 verified  (a real WAV conversion brand — see
//                                                         inferConversionManufacturer in
//                                                         mobility-van-sales.ts/ams-vans-
//                                                         classifieds.ts for the same brand vocabulary)
// Tried and NOT added: 'vantage mobility' (total=5, too little recall to
// justify the extra search call), 'rollx vans' and 'driverge' (both
// total=0 as exact phrases — see the discovery block for retrying a looser
// phrasing if this is revisited).
export const SEARCH_KEYWORDS = [
  'wheelchair van',
  'wheelchair accessible van',
  'handicap accessible van',
  'mobility van conversion',
  'wav',
  'handicap van',
  'disability van',
  'braunability',
] as const

const PRODUCTION_HOST = 'api.ebay.com'
const SANDBOX_HOST = 'api.sandbox.ebay.com'
const TOKEN_TTL_SAFETY_MARGIN_SECONDS = 60

export interface EbayMotorsConfig {
  previousPage1Hash?: string | null
  ebayCredentials?: EbayCredentials
  pageDelayMs?: number
  detailDelayMs?: number
  maxItems?: number
  fetchFn?: typeof fetch
}

export function createSourceAdapter(
  previousHash: string | null,
  config: EbayMotorsConfig = {},
): SourceAdapter {
  return new EbayMotorsAdapter(previousHash, config)
}

interface EbaySearchItem {
  itemId: string
  /** Optional in the type because a malformed/partial API response can omit it — not every field summary guarantees. */
  itemWebUrl?: string
}

interface EbaySearchResponse {
  total?: number
  limit?: number
  offset?: number
  itemSummaries?: EbaySearchItem[]
  warnings?: unknown[]
}

interface EbayAspect {
  name: string
  value: string
}

/**
 * `getItem` response shape — verified 2026-10-01 against a live production
 * Browse API response (#999). Unlike `item_summary/search`, this carries
 * `itemLocation.city`/`stateOrProvince` and `localizedAspects`, which is
 * where VIN, mileage, and the private/dealer seller signal actually live —
 * none of those are present on item_summary.
 */
interface EbayItemDetail {
  itemId: string
  title: string
  legacyItemId?: string
  itemWebUrl?: string
  price?: { value: string; currency: string }
  condition?: string
  image?: { imageUrl: string }
  additionalImages?: { imageUrl: string }[]
  /** `postalCode` is masked (e.g. "481**") even on getItem — never store it as a literal ZIP. */
  itemLocation?: { city?: string; stateOrProvince?: string; postalCode?: string }
  localizedAspects?: EbayAspect[]
  description?: string
  itemCreationDate?: string
}

interface CachedToken {
  accessToken: string
  expiresAtMs: number
}

export class EbayMotorsAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'eBay Motors'

  private readonly previousHash: string | null
  private readonly credentials: EbayCredentials | undefined
  private readonly pageDelayMs: number
  private readonly detailDelayMs: number
  private readonly maxItems: number
  private readonly fetchFn: typeof fetch
  private readonly host: string
  private cachedToken: CachedToken | null = null

  constructor(previousHash: string | null = null, config: EbayMotorsConfig = {}) {
    this.previousHash = previousHash
    this.credentials = config.ebayCredentials
    this.pageDelayMs = config.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS
    this.detailDelayMs = config.detailDelayMs ?? DEFAULT_DETAIL_DELAY_MS
    this.maxItems = config.maxItems ?? MAX_ITEMS_PER_RUN
    this.fetchFn = config.fetchFn ?? fetch
    this.host = config.ebayCredentials?.environment === 'sandbox' ? SANDBOX_HOST : PRODUCTION_HOST
  }

  private requireCredentials(): EbayCredentials {
    if (!this.credentials) {
      throw new Error('[ebay-motors] missing eBay Browse API credentials (ebay.motors.* config keys)')
    }
    return this.credentials
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && this.cachedToken.expiresAtMs > now) {
      return this.cachedToken.accessToken
    }

    const { appId, certId } = this.requireCredentials()
    const basic = Buffer.from(`${appId}:${certId}`).toString('base64')
    const res = await this.fetchFn(`https://${this.host}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      throw new Error(`[ebay-motors] token exchange failed: ${res.status} ${await res.text()}`)
    }

    const body = (await res.json()) as { access_token: string; expires_in: number }
    this.cachedToken = {
      accessToken: body.access_token,
      expiresAtMs: now + (body.expires_in - TOKEN_TTL_SAFETY_MARGIN_SECONDS) * 1000,
    }
    return this.cachedToken.accessToken
  }

  /** GET with 429 handling: honors Retry-After, else exponential backoff; throws after maxAttempts. */
  private async getJson<T>(path: string, query: URLSearchParams, context?: JobContext): Promise<T> {
    const maxAttempts = 5
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const token = await this.getAccessToken()
      const res = await this.fetchFn(`https://${this.host}${path}?${query}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (res.status === 429) {
        const retryAfterHeader = res.headers.get('Retry-After')
        const retryAfterMs = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) * 1000 : NaN
        const backoffMs = Number.isFinite(retryAfterMs) ? retryAfterMs : 500 * 2 ** (attempt - 1)
        await report(context, `[ebay-motors] rate limited (429) — backing off ${backoffMs}ms (attempt ${attempt}/${maxAttempts})`, {
          stage: 'scraping',
          source: SOURCE_ID,
          reason: 'rate_limited',
        })
        if (attempt === maxAttempts) {
          throw new Error('[ebay-motors] exhausted retries after repeated 429 responses')
        }
        await jitteredSleep(backoffMs)
        continue
      }

      if (!res.ok) {
        throw new Error(`[ebay-motors] ${path} failed: ${res.status} ${await res.text()}`)
      }

      return (await res.json()) as T
    }
    throw new Error('[ebay-motors] unreachable')
  }

  async checkStructure(): Promise<StructureCheckResult> {
    const query = new URLSearchParams({
      q: SEARCH_KEYWORDS[0],
      category_ids: MOTORS_CATEGORY_ID,
      limit: '1',
    })
    const response = await this.getJson<EbaySearchResponse>('/buy/browse/v1/item_summary/search', query)
    // Hashes the top-level response envelope's key set, not an individual
    // item's — item_summary fields are optional and vary per item
    // (auctions lack `price`, some items lack `additionalImages`, etc.), so
    // hashing one sample item's keys would flap between runs depending on
    // which item happened to come back first. The envelope (total/limit/
    // offset/itemSummaries/warnings) is what eBay's response contract
    // actually guarantees; a changed envelope shape signals eBay altered
    // that contract.
    const signature = Object.keys(response).sort().join(',')
    const currentHash = createHash('sha256').update(signature).digest('hex')
    const changed = this.previousHash !== null && this.previousHash !== currentHash
    return { changed, currentHash, previousHash: this.previousHash }
  }

  async scrape(context?: JobContext): Promise<ScrapeResult> {
    const itemIds = new Set<string>()

    for (const keyword of SEARCH_KEYWORDS) {
      let offset = 0
      while (itemIds.size < this.maxItems) {
        const query = new URLSearchParams({
          q: keyword,
          category_ids: MOTORS_CATEGORY_ID,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        })
        const response = await this.getJson<EbaySearchResponse>(
          '/buy/browse/v1/item_summary/search',
          query,
          context,
        )
        const page = response.itemSummaries ?? []
        for (const item of page) itemIds.add(item.itemId)

        await report(context, `[ebay-motors] "${keyword}" offset=${offset}: ${page.length} item(s), ${itemIds.size} unique so far`, {
          stage: 'scraping',
          source: SOURCE_ID,
          listings: itemIds.size,
        })

        offset += PAGE_SIZE
        const total = response.total ?? 0
        const donePaging = page.length === 0 || offset >= total || itemIds.size >= this.maxItems
        if (donePaging) break
        await jitteredSleep(this.pageDelayMs)
      }
    }

    const ids = [...itemIds].slice(0, this.maxItems)
    const listings: Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'>[] = []

    for (let i = 0; i < ids.length; i++) {
      const itemId = ids[i]!
      let detail: EbayItemDetail | null = null
      try {
        detail = await this.getJson<EbayItemDetail>(
          `/buy/browse/v1/item/${encodeURIComponent(itemId)}`,
          new URLSearchParams(),
          context,
        )
      } catch (err) {
        await report(context, `[ebay-motors] getItem failed for ${itemId} — skipping: ${(err as Error).message}`, {
          stage: 'scraping',
          source: SOURCE_ID,
          reason: 'detail_fetch_failed',
        })
      }

      if (detail) {
        const listing = buildListing(detail)
        if (listing) listings.push(listing)
      }

      if ((i + 1) % 50 === 0 || i === ids.length - 1) {
        await report(context, `[ebay-motors] fetched detail ${i + 1}/${ids.length}; ${listings.length} listing(s) so far`, {
          stage: 'scraping',
          source: SOURCE_ID,
          listings: listings.length,
        })
      }

      if (i < ids.length - 1) await jitteredSleep(this.detailDelayMs)
    }

    const fingerprintHash = createHash('sha256')
      .update(listings.map((l) => l.sourceRecordKey).sort().join('|'))
      .digest('hex')

    return { listings, fingerprintHash }
  }
}

function aspectsToMap(aspects: EbayAspect[] | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  for (const aspect of aspects ?? []) {
    if (aspect.name && aspect.value) map[aspect.name] = aspect.value
  }
  return map
}

export function buildListing(item: EbayItemDetail): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  if (!item.itemWebUrl) return null

  const aspects = aspectsToMap(item.localizedAspects)
  const titleParsed = parseVehicleTitle(stripConditionPrefix(item.title))
  const plausibleYear = titleParsed.year >= 1975 && titleParsed.year <= 2100
  if (!plausibleYear || !titleParsed.make || !titleParsed.model) return null

  const rawVin = aspects['VIN (Vehicle Identification Number)'] ?? null
  const qualityIssueCodes: string[] = []
  let vin: string | null = null
  if (rawVin) {
    const normalized = normalizeVin(rawVin)
    if (!isValidVin(normalized)) {
      qualityIssueCodes.push('unparseable_vin')
    } else {
      vin = normalized
      if (!checkDigitValid(normalized)) qualityIssueCodes.push('invalid_check_digit')
    }
  }

  const images = [item.image?.imageUrl, ...(item.additionalImages?.map((i) => i.imageUrl) ?? [])]
    .filter((url): url is string => Boolean(url))
    .filter(isVehicleImageUrl)

  const priceCents = item.price?.value
    ? Math.round(Number.parseFloat(item.price.value) * 100)
    : null

  const mileage = aspects['Mileage'] ? Number.parseInt(aspects['Mileage'], 10) : null

  // Verified 2026-10-01 against a live getItem response: the business-vs-
  // private disclosure signal for EBAY_US is the `localizedAspects` entry
  // named "For Sale By" (seen value: "Private Seller"), not a
  // `seller.sellerAccountType` field — that field does not appear anywhere
  // in the getItem response at all. Default to 'dealer' when the aspect is
  // absent or doesn't say "Private" — matching BLVD's (#176) convention of
  // requiring an explicit private-seller signal rather than assuming
  // private by default — so a listing with no disclosed seller type doesn't
  // wrongly go through the private-seller phone-suppression/30-day-anonymize
  // pipeline.
  const forSaleBy = aspects['For Sale By'] ?? ''
  const sellerType = /private/i.test(forSaleBy) ? 'private' : 'dealer'

  return {
    sourceId: SOURCE_ID,
    sourceUrl: item.itemWebUrl,
    buyerUrl: item.itemWebUrl,
    externalId: item.legacyItemId ?? item.itemId,
    stockNumber: null,
    sourceRecordKey: item.itemId,
    make: aspects['Make'] ?? titleParsed.make,
    model: titleParsed.model,
    year: parseAspectYear(aspects['Year']) ?? titleParsed.year,
    trim: aspects['Trim'] ?? titleParsed.trim,
    vin,
    condition: parseCondition(item.condition),
    sellerType,
    priceCents,
    mileage,
    color: aspects['Exterior Color'] ?? null,
    fuelType: aspects['Fuel Type'] ?? null,
    transmission: aspects['Transmission'] ?? null,
    wav: {
      conversionType: 'unknown',
      conversionManufacturer: null,
      floorLoweringInches: null,
      rampType: 'unknown',
      conversionStatus: 'unknown',
      wavFeatures: inferWavFeatures(aspects['Features']),
      wheelchairCapacity: null,
    },
    location: {
      // `postalCode` is masked even on getItem (e.g. "481**") — never stored
      // as a literal ZIP.
      zip: null,
      city: item.itemLocation?.city ?? null,
      state: item.itemLocation?.stateOrProvince ?? null,
      lat: null,
      lng: null,
    },
    dealer: { name: null, phone: null, website: null },
    images,
    description: item.description ? stripTags(item.description) : null,
    ...(qualityIssueCodes.length > 0 ? { qualityIssueCodes } : {}),
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date(),
    sourceListedAt: item.itemCreationDate ? new Date(item.itemCreationDate) : null,
    sourceUpdatedAt: null,
  }
}

function stripConditionPrefix(title: string): string {
  return title.replace(/^(New|Used|Certified Pre-Owned)\s+/i, '')
}

function parseCondition(condition: string | undefined): Listing['condition'] {
  const normalized = (condition ?? '').toLowerCase()
  if (normalized.includes('certified')) return 'certified_pre_owned'
  if (normalized.includes('new')) return 'new'
  return 'used'
}

function parseAspectYear(value: string | undefined): number | null {
  if (!value) return null
  const year = Number.parseInt(value, 10)
  return Number.isFinite(year) ? year : null
}

function inferWavFeatures(features: string | undefined): Listing['wav']['wavFeatures'] {
  const result: Listing['wav']['wavFeatures'] = []
  const t = (features ?? '').toLowerCase()
  if (t.includes('hand control')) result.push('hand_controls')
  if (t.includes('kneel')) result.push('kneel_system')
  if (t.includes('lowered floor')) result.push('lowered_floor')
  if (t.includes('power ramp')) result.push('power_ramp')
  if (t.includes('lift')) result.push('has_lift')
  return result
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
