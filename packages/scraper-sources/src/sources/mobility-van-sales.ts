import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { SourceAdapter, ScrapeResult, StructureCheckResult, Page1CheckResult } from '../engine/source-adapter.js'
import type { ConversionType, Listing, ListingCondition, ListingSellerType, RampType } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import { report } from '../jobs/job-progress.js'
import { RobotsCache } from '../util/robots-cache.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/types'
import { isVehicleImageUrl } from './image-filter.js'
import { parseVehicleTitle } from '../lib/parse-vehicle-title.js'

const SOURCE_ID = 'mobility-van-sales'
const BASE_URL = 'https://www.mobilityvansales.com'
const MAIN_BROWSE_PATH = '/used-handicap-vans/usa-handicap-vansales.html'
const USER_AGENT = 'WivWav/1.0 (wivwav.com)'
const REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_DETAIL_FETCH_DELAY_MS = 1_500
const DEFAULT_INDEX_FETCH_DELAY_MS = 750

// Robots.txt review (2026-09-02, ahead of #1002): https://www.mobilityvansales.com/robots.txt
// disallows /search-used-handicapvans.html and /search-used-handicapvans/search.html
// (pagination POST/GET search endpoint) for User-agent: *. Does not disallow /buy/*.htm
// detail pages, /used-handicap-vans/*.html category browse pages, or /search/*.html
// make/state index pages. No crawl-delay directive is set.
//
// Terms review (same date): /legal/terms_conditions.html includes a "No Automated Querying"
// clause — flagged on #1002 for product/legal awareness; this adapter honors robots.txt
// disallows, uses referral-only buyerUrl, and never extracts seller phone/email fields.
//
// TLS review (same date): the site's certificate is expired; Node's default fetch() fails
// validation. defaultFetchPage() uses an origin-scoped HTTPS agent with rejectUnauthorized:
// false for mobilityvansales.com only so crawls can proceed until the site renews its cert.

/** Minimal fetch result shape — testable without depending on the global fetch signature. */
export interface FetchResult {
  url: string
  status: number
  text: string
}

export type FetchPage = (url: string) => Promise<FetchResult>

interface MobilityVanSalesConfig {
  previousPage1Hash?: string | null
  robotsCache?: RobotsCache
  fetchPage?: FetchPage
  detailFetchDelayMs?: number
  indexFetchDelayMs?: number
  maxListings?: number
}

export function createSourceAdapter(
  previousHash: string | null,
  config: MobilityVanSalesConfig = {},
): SourceAdapter {
  return new MobilityVanSalesAdapter(previousHash, config)
}

export interface ParsedBrowseCard {
  adId: string
  detailUrl: string
  sellerTypeLabel: string | null
  priceText: string | null
  titleText: string | null
  mileageText: string | null
  conditionLabel: string | null
  imageUrl: string | null
}

export interface ParsedDetailPage {
  adId: string | null
  sellerType: ListingSellerType | null
  fields: Record<string, string>
  locationHeader: string | null
  description: string | null
  priceText: string | null
  imageUrls: string[]
}

const BROWSE_CATEGORY_PATHS = [
  'usa-handicap-vansales.html',
  'usa-mini%20van-vansales.html',
  'usa-full%20size%20van-vansales.html',
  'usa-truck-vansales.html',
  'usa-motorcycle-vansales.html',
  'usa-side%20entry-vansales.html',
  'usa-rear%20entry-vansales.html',
] as const

const BROWSE_MAKE_PATHS = [
  'toyota-wheelchair-vans-for-sale_c865.html',
  'honda-wheelchair-vans-for-sale_c865.html',
  'dodge-wheelchair-vans-for-sale_c865.html',
  'chrysler-wheelchair-vans-for-sale_c865.html',
  'ford-wheelchair-vans-for-sale_c865.html',
  'chevrolet-wheelchair-vans-for-sale_c865.html',
] as const

const STATE_SLUGS = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'district of columbia', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois',
  'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts',
  'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota',
  'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
  'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming',
] as const

const STATE_NAME_TO_ABBR: Readonly<Record<string, string>> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

export class MobilityVanSalesAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'MobilityVanSales'

  private readonly previousHash: string | null
  private readonly previousPage1Hash: string | null
  private readonly robotsCache: RobotsCache
  private readonly fetchPage: FetchPage
  private readonly detailFetchDelayMs: number
  private readonly indexFetchDelayMs: number
  private readonly maxListings: number

  constructor(previousHash: string | null = null, config: MobilityVanSalesConfig = {}) {
    this.previousHash = previousHash
    this.previousPage1Hash = config.previousPage1Hash ?? null
    this.robotsCache = config.robotsCache ?? new RobotsCache()
    this.fetchPage = config.fetchPage ?? defaultFetchPage
    this.detailFetchDelayMs = config.detailFetchDelayMs ?? DEFAULT_DETAIL_FETCH_DELAY_MS
    this.indexFetchDelayMs = config.indexFetchDelayMs ?? DEFAULT_INDEX_FETCH_DELAY_MS
    this.maxListings = config.maxListings ?? Infinity
  }

  private async fetchAllowed(url: string, context?: JobContext, logPrefix?: string): Promise<FetchResult | null> {
    const allowed = await this.robotsCache.isAllowed(url, USER_AGENT)
    if (!allowed) {
      await report(context, `${logPrefix ?? '[mobility-van-sales]'} robots.txt disallows ${url} — skipping`, {
        stage: 'scraping',
        source: SOURCE_ID,
        reason: 'robots_disallowed',
      })
      return null
    }
    return this.fetchPage(url)
  }

  async checkPage1(): Promise<Page1CheckResult> {
    const result = await this.fetchPage(`${BASE_URL}${MAIN_BROWSE_PATH}`)
    const adIds = extractBrowseAdIds(result.text)
    const currentHash = hashPage1Entries(adIds)
    const changed = this.previousPage1Hash === null || this.previousPage1Hash !== currentHash
    return { currentHash, changed }
  }

  async checkStructure(): Promise<StructureCheckResult> {
    const browse = await this.fetchPage(`${BASE_URL}${MAIN_BROWSE_PATH}`)
    const cards = parseBrowsePageHtml(browse.text)
    const sampleUrl = cards[0]?.detailUrl
    if (!sampleUrl) {
      throw new Error('[mobility-van-sales] Main browse page returned zero parseable cards for structure check')
    }

    const detail = await this.fetchPage(sampleUrl)
    const parsed = parseDetailPageHtml(detail.text)
    const signature = `badges:${Object.keys(parsed.fields).sort().join(',')}|seller:${parsed.sellerType ?? 'none'}`

    const currentHash = createHash('sha256').update(signature).digest('hex')
    const changed = this.previousHash !== null && this.previousHash !== currentHash
    return {
      changed,
      currentHash,
      previousHash: this.previousHash,
      ...(changed ? { sampleHtml: detail.text } : {}),
    }
  }

  async scrape(context?: JobContext): Promise<ScrapeResult> {
    const listings: Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'>[] = []
    const detailUrls = new Set<string>()

    await report(context, '[mobility-van-sales] Discovering listing detail URLs from browse indexes', {
      stage: 'scraping',
      source: SOURCE_ID,
      listings: 0,
    })

    const indexUrls = buildDiscoveryIndexUrls()
    const visitedIndexes = new Set<string>()
    const pendingIndexes = [...indexUrls]

    while (pendingIndexes.length > 0) {
      const indexUrl = pendingIndexes.shift()!
      if (visitedIndexes.has(indexUrl)) continue
      visitedIndexes.add(indexUrl)

      const result = await this.fetchAllowed(indexUrl, context, '[mobility-van-sales]')
      if (result === null || result.status !== 200) continue

      for (const card of parseBrowsePageHtml(result.text)) {
        detailUrls.add(card.detailUrl)
      }

      for (const secondary of extractSecondaryBrowseUrls(result.text)) {
        const absolute = secondary.startsWith('http') ? secondary : `${BASE_URL}${secondary}`
        if (!visitedIndexes.has(absolute) && !pendingIndexes.includes(absolute)) {
          pendingIndexes.push(absolute)
        }
      }

      if (pendingIndexes.length > 0) await jitteredSleep(this.indexFetchDelayMs)
    }

    const urls = [...detailUrls].slice(0, this.maxListings)

    await report(context, `[mobility-van-sales] Discovered ${urls.length} unique detail URL(s)`, {
      stage: 'scraping',
      source: SOURCE_ID,
      listings: 0,
    })

    for (let i = 0; i < urls.length; i++) {
      const detailUrl = urls[i]!
      const result = await this.fetchAllowed(detailUrl, context, '[mobility-van-sales]')
      if (result === null) continue

      if (result.status === 404) {
        await report(context, `[mobility-van-sales] ${detailUrl} is gone (404) — skipping`, {
          stage: 'scraping',
          source: SOURCE_ID,
          reason: 'not_found',
        })
      } else if (result.status === 200) {
        const listing = buildListing(parseDetailPageHtml(result.text), result.url)
        if (listing) listings.push(listing)
      }

      if ((i + 1) % 25 === 0 || i === urls.length - 1) {
        await report(context, `[mobility-van-sales] Fetched ${i + 1}/${urls.length} detail page(s); ${listings.length} listing(s) so far`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: i + 1,
          listings: listings.length,
        })
      }

      if (i < urls.length - 1) await jitteredSleep(this.detailFetchDelayMs)
    }

    const fingerprintHash = createHash('sha256')
      .update(listings.map(l => l.sourceRecordKey).sort().join('|'))
      .digest('hex')

    return { listings, fingerprintHash }
  }
}

export function buildDiscoveryIndexUrls(): string[] {
  const urls = [
    `${BASE_URL}${MAIN_BROWSE_PATH}`,
    ...BROWSE_CATEGORY_PATHS.map((path) => `${BASE_URL}/used-handicap-vans/${path}`),
    ...BROWSE_MAKE_PATHS.map((path) => `${BASE_URL}/search/${path}`),
    ...STATE_SLUGS.map((slug) => `${BASE_URL}/search/find-new-used-${slug}_wheelchair-vans.html`),
  ]
  return urls
}

export function extractSecondaryBrowseUrls(html: string): string[] {
  const urls = new Set<string>()
  const pattern = /href="(\/used-handicap-vans\/[^"]+_vansales\.html)"/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const href = match[1]
    if (href) urls.add(href)
  }
  return [...urls]
}

export function extractBrowseAdIds(html: string): string[] {
  return parseBrowsePageHtml(html).map((card) => card.adId)
}

export function parseBrowsePageHtml(html: string): ParsedBrowseCard[] {
  const cards: ParsedBrowseCard[] = []
  const itemPattern = /<div class="result-item format-standard" listingID="(\d+)">([\s\S]*?)<!-- Result Item -->/gi
  let match: RegExpExecArray | null

  while ((match = itemPattern.exec(html)) !== null) {
    const adId = match[1] ?? ''
    const block = match[2] ?? ''
    if (!adId || !block) continue

    const detailMatch = /href="(https:\/\/www\.mobilityvansales\.com\/buy\/[^"]+\.htm)"/i.exec(block)
    const detailUrl = detailMatch?.[1] ?? ''
    if (!detailUrl) continue

    const sellerTypeLabel = extractSellerTypeLabel(block)
    const priceMatch = /<div class="price">([^<]+)<\/div>/i.exec(block)
    const titleMatch = /<h4 class="result-item-title">\s*<a[^>]*>([^<]+)<\/a>/i.exec(block)
    const mileageMatch = /<li class="item-odometer">([^<]+)<\/li>/i.exec(block)
    const conditionMatch = /<span class="label label-success premium-listing">([^<]+)<\/span>/i.exec(block)
    const imageMatch = /<img[^>]+src="([^"]+van_ad_photos[^"]+)"/i.exec(block)

    cards.push({
      adId,
      detailUrl,
      sellerTypeLabel,
      priceText: priceMatch?.[1] ? decodeHtmlEntities(priceMatch[1]).trim() : null,
      titleText: titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]).trim() : null,
      mileageText: mileageMatch?.[1] ? decodeHtmlEntities(mileageMatch[1]).trim() : null,
      conditionLabel: conditionMatch?.[1] ? decodeHtmlEntities(conditionMatch[1]).trim() : null,
      imageUrl: imageMatch?.[1] ?? null,
    })
  }

  return cards
}

export function parseDetailPageHtml(html: string): ParsedDetailPage {
  const fields = parseListGroupFields(html)
  const adId = fields['Ad ID'] ?? null
  const sellerType = parseSellerType(html)
  const locationHeader = extractLocationHeader(html)
  const description = extractVehicleDescription(html)
  const priceText = extractDetailPrice(html)
  const imageUrls = extractDetailImageUrls(html)

  return { adId, sellerType, fields, locationHeader, description, priceText, imageUrls }
}

export function parseListGroupFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const pattern = /<li class='list-group-item'>\s*<span class='badge'>([^<]+)\s*<\/span>\s*([^<]+(?:<a[^>]*>([^<]*)<\/a>)?[^<]*)/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html)) !== null) {
    const label = decodeHtmlEntities(match[1] ?? '').trim()
    const anchorValue = match[3]
    const rawValue = anchorValue ?? match[2] ?? ''
    const value = decodeHtmlEntities(stripTags(rawValue)).trim()
    if (label && value && !label.startsWith('More:') && !label.startsWith('View:')) {
      fields[label] = value
    }
  }

  return fields
}

export function parseSellerType(html: string): ListingSellerType | null {
  const normalized = html.toLowerCase()
  if (normalized.includes('dealer listing')) return 'dealer'
  if (normalized.includes('private listing')) return 'private'
  return null
}

export function buildListing(
  parsed: ParsedDetailPage,
  detailUrl: string,
): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  const year = parseYear(parsed.fields['Year'])
  const make = normalizeLabel(parsed.fields['Make'])
  const model = normalizeLabel(parsed.fields['Model'])
  if (year === null || !make || !model) return null

  const sellerType = parsed.sellerType ?? 'private'
  const rawVin = parsed.fields['VIN'] ?? null
  const normalizedVinValue = rawVin ? normalizeVin(rawVin) : ''
  const qualityIssueCodes: string[] = []
  let vin: string | null = null

  if (rawVin) {
    if (!isValidVin(normalizedVinValue)) {
      qualityIssueCodes.push('unparseable_vin')
    } else {
      vin = normalizedVinValue
      if (!checkDigitValid(normalizedVinValue)) qualityIssueCodes.push('invalid_check_digit')
    }
  }

  const titleFromFields = `${year} ${make} ${model}`
  const titleParsed = parseVehicleTitle(titleFromFields)
  const priceCents = parsePriceCents(parsed.priceText ?? parsed.fields['Price'] ?? null)
  const mileage = parseMileage(parsed.fields['Miles'] ?? null)
  const condition = parseConditionFromUrl(detailUrl) ?? parseConditionLabel(parsed.fields['Condition'] ?? null)
  const location = parseLocationHeader(parsed.locationHeader)
  const handicapEntry = parsed.fields['Handicap Entry'] ?? null

  const images = parsed.imageUrls
    .map(normalizeImageUrl)
    .filter(isVehicleImageUrl)

  const adId = parsed.adId ?? extractAdIdFromUrl(detailUrl)
  const sourceRecordKey = adId ?? vin ?? normalizeSourceUrl(detailUrl)

  return {
    sourceId: SOURCE_ID,
    sourceUrl: detailUrl,
    buyerUrl: detailUrl,
    externalId: adId,
    stockNumber: adId,
    sourceRecordKey,
    make: titleParsed?.make ?? make,
    model: titleParsed?.model ?? model,
    year: titleParsed?.year ?? year,
    trim: titleParsed?.trim ?? null,
    vin,
    condition,
    sellerType,
    priceCents,
    mileage,
    color: parsed.fields['Ext Color'] ?? null,
    fuelType: parsed.fields['Fuel'] ?? null,
    transmission: parsed.fields['Transmission'] ?? null,
    wav: {
      conversionType: parseConversionType(handicapEntry),
      conversionManufacturer: inferConversionManufacturer(parsed.description),
      floorLoweringInches: null,
      rampType: parseRampType(parsed.description),
      conversionStatus: 'unknown',
      wavFeatures: inferWavFeatures(parsed.description),
      wheelchairCapacity: null,
    },
    location,
    dealer: { name: null, phone: null, website: null },
    images,
    description: parsed.description,
    ...(qualityIssueCodes.length > 0 ? { qualityIssueCodes } : {}),
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date(),
    sourceListedAt: null,
    sourceUpdatedAt: null,
  }
}

export function hashPage1Entries(entries: string[]): string {
  return createHash('sha256').update([...entries].sort().join(',') || 'empty').digest('hex')
}

export function parseConversionType(handicapEntry: string | null): ConversionType {
  const t = (handicapEntry ?? '').toLowerCase()
  if (t.includes('rear')) return 'rear_entry'
  if (t.includes('side')) return 'side_entry'
  return 'unknown'
}

export function parseRampType(description: string | null): RampType {
  const t = (description ?? '').toLowerCase()
  if (t.includes('in-floor') || t.includes('in floor')) return 'in_floor'
  if (t.includes('fold-out') || t.includes('fold out')) return 'fold_out'
  if (t.includes('fold-in') || t.includes('fold in')) return 'fold_in'
  return 'unknown'
}

export function parsePriceCents(priceText: string | null): number | null {
  if (!priceText) return null
  const digits = priceText.replace(/[^0-9]/g, '')
  if (!digits) return null
  return Number.parseInt(digits, 10) * 100
}

export function parseMileage(mileageText: string | null): number | null {
  if (!mileageText) return null
  const digits = mileageText.replace(/[^0-9]/g, '')
  if (!digits) return null
  const value = Number.parseInt(digits, 10)
  return Number.isFinite(value) ? value : null
}

export function parseLocationHeader(header: string | null): Listing['location'] {
  if (!header) return { zip: null, city: null, state: null, lat: null, lng: null }
  const match = /^(.+?),\s*([A-Za-z .]+?)(?:\s+(\d{5}))?$/.exec(header.trim())
  if (!match) return { zip: null, city: null, state: null, lat: null, lng: null }

  const city = match[1]?.trim() || null
  const stateName = match[2]?.trim().toLowerCase() ?? ''
  const zip = match[3] ?? null
  const state = STATE_NAME_TO_ABBR[stateName] ?? match[2]?.trim() ?? null
  return { zip, city, state, lat: null, lng: null }
}

export function normalizeImageUrl(url: string): string {
  if (url.startsWith('//')) return `https:${url}`
  return url.replace('/thumb_', '/')
}

export function normalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`.replace(/\/$/, '')
  } catch {
    return url
  }
}

function defaultFetchPage(url: string): Promise<FetchResult> {
  return fetchWithTlsBypass(url, { 'User-Agent': USER_AGENT }, REQUEST_TIMEOUT_MS)
}

async function fetchWithTlsBypass(
  startUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxRedirects = 5,
): Promise<FetchResult> {
  const startHostname = new URL(startUrl).hostname
  let currentUrl = startUrl

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const result = await fetchOnce(currentUrl, headers, timeoutMs)
    if (result.status >= 300 && result.status < 400 && result.location) {
      const redirectUrl = new URL(result.location, currentUrl)
      // Because TLS validation is bypassed for TLS_BYPASS_HOSTNAME, an on-path
      // attacker who MITMs that host could otherwise inject a redirect to an
      // arbitrary (e.g. internal) host. Refuse to follow off-host redirects.
      if (redirectUrl.hostname !== startHostname || redirectUrl.protocol !== 'https:') {
        throw new Error(`[mobility-van-sales] Refusing cross-host redirect from ${currentUrl} to ${redirectUrl}`)
      }
      currentUrl = redirectUrl.toString()
      continue
    }
    return { url: currentUrl, status: result.status, text: result.text }
  }

  throw new Error(`[mobility-van-sales] Too many redirects for ${startUrl}`)
}

const TLS_BYPASS_HOSTNAME = 'www.mobilityvansales.com'

function fetchOnce(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; text: string; location: string | null }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const requestFn = isHttps ? httpsRequest : httpRequest
    const bypassTls = isHttps && parsed.hostname === TLS_BYPASS_HOSTNAME

    const req = requestFn(
      url,
      {
        headers,
        method: 'GET',
        ...(bypassTls ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
            location: res.headers.location ?? null,
          })
        })
      },
    )

    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`[mobility-van-sales] Request timed out after ${timeoutMs}ms for ${url}`))
    })
    req.end()
  })
}

function extractDetailImageUrls(html: string): string[] {
  const urls = new Set<string>()
  const pattern = /(?:data-rsbigimg|href)="(https:\/\/www\.mobilityvansales\.com\/van_ad_photos\/[^"]+)"/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const url = match[1]
    if (url) urls.add(url)
  }
  return [...urls]
}

function extractLocationHeader(html: string): string | null {
  const match = /<h4>\s*([^<]*,\s*[A-Za-z][^<]*\d{5})\s*<\/h4>/i.exec(html)
  return match?.[1] ? decodeHtmlEntities(match[1]).trim() : null
}

function extractVehicleDescription(html: string): string | null {
  const match = /<h4>Vehicle Description<\/h4>\s*<p>([\s\S]*?)<\/p>/i.exec(html)
  if (!match?.[1]) return null
  return decodeHtmlEntities(stripTags(match[1])).replace(/\s+/g, ' ').trim() || null
}

function extractAdIdFromUrl(url: string): string | null {
  const match = /-(\d+)\.htm(?:\?|$)/i.exec(url)
  return match?.[1] ?? null
}

function parseYear(value: string | undefined): number | null {
  if (!value) return null
  const year = Number.parseInt(value, 10)
  return Number.isFinite(year) && year >= 1975 && year <= 2100 ? year : null
}

function parseConditionFromUrl(url: string): ListingCondition | null {
  if (/\/buy\/NEW-/i.test(url)) return 'new'
  if (/\/buy\/USED-/i.test(url)) return 'used'
  return null
}

function parseConditionLabel(label: string | null): ListingCondition {
  const normalized = (label ?? '').toLowerCase()
  if (normalized === 'new') return 'new'
  return 'used'
}

function normalizeLabel(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function inferConversionManufacturer(description: string | null): string | null {
  const t = (description ?? '').toLowerCase()
  if (t.includes('braunability') || t.includes('braun ability')) return 'BraunAbility'
  if (t.includes('vmi') || t.includes('vantage mobility')) return 'VMI'
  if (t.includes('rollx')) return 'Rollx Vans'
  if (t.includes('driverge')) return 'Driverge'
  return null
}

function inferWavFeatures(description: string | null): Listing['wav']['wavFeatures'] {
  const features: Listing['wav']['wavFeatures'] = []
  const t = (description ?? '').toLowerCase()
  if (t.includes('hand control')) features.push('hand_controls')
  if (t.includes('kneel')) features.push('kneel_system')
  if (t.includes('lowered floor')) features.push('lowered_floor')
  if (t.includes('power ramp')) features.push('power_ramp')
  if (t.includes('lift')) features.push('has_lift')
  return features
}

function extractSellerTypeLabel(block: string): string | null {
  if (/dealer listing/i.test(block)) return 'Dealer Listing'
  if (/private listing/i.test(block)) return 'Private Listing'
  return null
}

function extractDetailPrice(html: string): string | null {
  const match = /<div class="[^"]*\bprice\b[^"]*">([^<]+)<\/div>/i.exec(html)
  return match?.[1] ? decodeHtmlEntities(match[1]).trim() : null
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#36;/g, '$')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
