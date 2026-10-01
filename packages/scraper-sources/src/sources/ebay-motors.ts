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
// Hard cap on items fetched per scrape() run — bounds both wall-clock time and
// the number of calls counted against the app's daily Browse API quota.
// Revisit alongside the cron frequency if the developer-portal quota changes.
const MAX_ITEMS_PER_RUN = 2_000
const REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_PAGE_DELAY_MS = 500
// eBay Motors has no dedicated "wheelchair accessible van" category — the
// Cars & Trucks category is combined with keyword search across the common
// ways sellers describe a WAV (#999).
const MOTORS_CATEGORY_ID = '6001'
const SEARCH_KEYWORDS = [
  'wheelchair van',
  'wheelchair accessible van',
  'handicap accessible van',
  'mobility van conversion',
] as const

const PRODUCTION_HOST = 'api.ebay.com'
const SANDBOX_HOST = 'api.sandbox.ebay.com'
const TOKEN_TTL_SAFETY_MARGIN_SECONDS = 60

export interface EbayMotorsConfig {
  previousPage1Hash?: string | null
  ebayCredentials?: EbayCredentials
  pageDelayMs?: number
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
  legacyItemId?: string
  title: string
  /** Optional in the type because a malformed/partial API response can omit it — not every field summary guarantees. */
  itemWebUrl?: string
  price?: { value: string; currency: string }
  condition?: string
  image?: { imageUrl: string }
  additionalImages?: { imageUrl: string }[]
  itemLocation?: { city?: string; stateOrProvince?: string; postalCode?: string }
  seller?: {
    username?: string
    /** Only populated for marketplaces with EU/UK business-seller disclosure rules — not EBAY_US. */
    sellerAccountType?: 'BUSINESS' | 'INDIVIDUAL'
  }
  itemCreationDate?: string
}

interface EbaySearchResponse {
  total?: number
  limit?: number
  offset?: number
  itemSummaries?: EbaySearchItem[]
  warnings?: unknown[]
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
  private readonly maxItems: number
  private readonly fetchFn: typeof fetch
  private readonly host: string
  private cachedToken: CachedToken | null = null

  constructor(previousHash: string | null = null, config: EbayMotorsConfig = {}) {
    this.previousHash = previousHash
    this.credentials = config.ebayCredentials
    this.pageDelayMs = config.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS
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
    const itemsById = new Map<string, EbaySearchItem>()

    for (const keyword of SEARCH_KEYWORDS) {
      let offset = 0
      while (itemsById.size < this.maxItems) {
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
        for (const item of page) itemsById.set(item.itemId, item)

        await report(context, `[ebay-motors] "${keyword}" offset=${offset}: ${page.length} item(s), ${itemsById.size} unique so far`, {
          stage: 'scraping',
          source: SOURCE_ID,
          listings: itemsById.size,
        })

        offset += PAGE_SIZE
        const total = response.total ?? 0
        const donePaging = page.length === 0 || offset >= total || itemsById.size >= this.maxItems
        if (donePaging) break
        await jitteredSleep(this.pageDelayMs)
      }
    }

    const listings: Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'>[] = []
    for (const item of itemsById.values()) {
      const listing = buildListing(item)
      if (listing) listings.push(listing)
    }

    const fingerprintHash = createHash('sha256')
      .update(listings.map((l) => l.sourceRecordKey).sort().join('|'))
      .digest('hex')

    return { listings, fingerprintHash }
  }
}

export function buildListing(item: EbaySearchItem): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  if (!item.itemWebUrl) return null

  const titleParsed = parseVehicleTitle(stripConditionPrefix(item.title))
  const plausibleYear = titleParsed.year >= 1975 && titleParsed.year <= 2100
  if (!plausibleYear || !titleParsed.make || !titleParsed.model) return null

  const rawVin = extractVin(item.title)
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

  // UNVERIFIED (#999): whether EBAY_US exposes `seller.sellerAccountType` on
  // item_summary at all is not confirmed against a live response — the field
  // is documented for EU/UK marketplaces under their business-seller
  // disclosure rules, and may only appear on getItem, not item_summary, for
  // any marketplace. Until confirmed, default to 'dealer' — matching BLVD's
  // (#176) convention of requiring an explicit private-seller signal
  // ("For Sale By Owner") rather than assuming private by default — so an
  // unconfirmed or absent field doesn't wrongly route ordinary dealer
  // listings through the private-seller phone-suppression/30-day-anonymize
  // pipeline.
  const sellerType = item.seller?.sellerAccountType === 'INDIVIDUAL' ? 'private' : 'dealer'

  return {
    sourceId: SOURCE_ID,
    sourceUrl: item.itemWebUrl,
    buyerUrl: item.itemWebUrl,
    externalId: item.legacyItemId ?? item.itemId,
    stockNumber: null,
    sourceRecordKey: item.itemId,
    make: titleParsed.make,
    model: titleParsed.model,
    year: titleParsed.year,
    trim: titleParsed.trim,
    vin,
    condition: parseCondition(item.condition),
    sellerType,
    priceCents,
    mileage: null,
    color: null,
    fuelType: null,
    transmission: null,
    wav: {
      conversionType: 'unknown',
      conversionManufacturer: null,
      floorLoweringInches: null,
      rampType: 'unknown',
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: {
      zip: item.itemLocation?.postalCode ?? null,
      city: item.itemLocation?.city ?? null,
      state: item.itemLocation?.stateOrProvince ?? null,
      lat: null,
      lng: null,
    },
    dealer: { name: null, phone: null, website: null },
    images,
    description: null,
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

function extractVin(title: string): string | null {
  const match = /\b([A-HJ-NPR-Z0-9]{17})\b/i.exec(title)
  return match?.[1] ?? null
}
