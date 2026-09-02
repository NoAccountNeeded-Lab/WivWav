import { createHash } from 'node:crypto'
import type { SourceAdapter, ScrapeResult, StructureCheckResult, Page1CheckResult } from '../engine/source-adapter.js'
import type { ConversionType, Listing, RampType } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import { report } from '../jobs/job-progress.js'
import { RobotsCache } from '../util/robots-cache.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/types'
import { isVehicleImageUrl } from './image-filter.js'

const SOURCE_ID = 'ams-vans-classifieds'
const BASE_URL = 'https://www.amsvans.com'
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`
// The sitemap lists classified ads under this path; each 308-redirects to the
// canonical `/wheelchair-vans/cl/{VIN}` page this adapter actually reads (see
// fetchClassifiedPage's use of the fetch Response's final `.url`).
const CLASSIFIEDS_SITEMAP_PATH = '/wheelchair-vans/classifieds/'
const USER_AGENT = 'WivWav/1.0 (wivwav.com)'
const REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_DETAIL_FETCH_DELAY_MS = 1_500

// Robots.txt review (2026-09-02, ahead of #998): https://www.amsvans.com/robots.txt
// disallows only /non-mobility/ and /api/img/ — neither /sitemap.xml (this
// adapter's discovery mechanism) nor the classified-ad detail paths
// (/wheelchair-vans/classifieds/{VIN}, redirecting to /wheelchair-vans/cl/{VIN})
// are restricted, and no crawl-delay directive is set.
//
// AMS Vans' own dealer/consignment inventory (`/wheelchair-vans/used`, etc.,
// registry key would be a separate source) is out of scope here — see #998's
// research notes for why the classifieds path, not the marketing landing page
// at the same URL slug, is what this adapter reads.

/** Minimal fetch result shape — testable without depending on the global fetch signature. */
export interface FetchResult {
  /** Final URL after redirects (e.g. `fetch()`'s `Response.url`). */
  url: string
  status: number
  text: string
}

export type FetchPage = (url: string) => Promise<FetchResult>

async function defaultFetchPage(url: string): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return { url: res.url, status: res.status, text: await res.text() }
}

interface AmsVansClassifiedsConfig {
  previousPage1Hash?: string | null
  robotsCache?: RobotsCache
  fetchPage?: FetchPage
  /** Delay between detail-page fetches — overridable in tests. Defaults to DEFAULT_DETAIL_FETCH_DELAY_MS. */
  detailFetchDelayMs?: number
  /** Caps how many discovered VINs are fetched per scrape() call — overridable in tests. */
  maxListings?: number
}

export function createSourceAdapter(
  previousHash: string | null,
  config: AmsVansClassifiedsConfig = {},
): SourceAdapter {
  return new AmsVansClassifiedsAdapter(previousHash, config)
}

/**
 * Shape of the `cl` (classified) record embedded server-side in each detail
 * page's `__NEXT_DATA__` JSON (`props.pageProps.page.data.cl`). This is the
 * source's actual data contract, not a DOM structure — see checkStructure()
 * for why hashing this object's key set is the equivalent of hashing a card
 * selector's structure elsewhere in this package.
 *
 * `owner_email` deliberately has no field here: the live payload includes the
 * submitter's personal email address, and this adapter must never read,
 * store, or forward it — see docs/ and #998's PR description for the
 * referral-posture rationale (#972).
 */
export interface ClassifiedRecord {
  vin: string
  zip: string | null
  price: number | null
  year: number
  make: string
  model: string
  trim: string | null
  mileage: number | null
  transmission: string | null
  color: string | null
  details: string | null
  images: string[]
  conv_make: string | null
  conv_location: string | null
  conv_type: string | null
  conv_wheelchairs: number | null
  approved: number
  deleted: number
  last_updated: number | null
}

interface ParsedDetailPage {
  pageType: string | null
  record: ClassifiedRecord | null
}

// Known conversion-manufacturer abbreviations/aliases observed in AMS Vans'
// `conv_make` field, mapped to the canonical names used elsewhere in this
// codebase (mirrors the allowlist superior-van.ts keeps in sync with
// packages/types/src/canonicalize.ts's KNOWN_CONVERTERS). An unrecognized
// value returns null rather than being passed through unverified — this
// field is filled in by the private seller themselves, so it is far less
// reliable than a dealer's own catalog data.
const KNOWN_MANUFACTURER_MAP: Record<string, string> = {
  'braunability': 'BraunAbility',
  'braun': 'BraunAbility',
  'vantage mobility (vmi)': 'VMI',
  'vantage mobility': 'VMI',
  'vantage mobility international': 'VMI',
  'vmi': 'VMI',
  'driverge vehicle innovations': 'Driverge',
  'driverge': 'Driverge',
  'ams vans': 'AMS Vans',
  'ams': 'AMS Vans',
  'rollx vans': 'Rollx Vans',
  'rollx': 'Rollx Vans',
  'eldorado': 'Eldorado',
  'mv-1': 'MV-1',
  'mv1': 'MV-1',
  'northstar': 'Northstar',
  'entervan': 'Entervan',
}

export class AmsVansClassifiedsAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'AMS Vans Mobility Classifieds'

  private readonly previousHash: string | null
  private readonly previousPage1Hash: string | null
  private readonly robotsCache: RobotsCache
  private readonly fetchPage: FetchPage
  private readonly detailFetchDelayMs: number
  private readonly maxListings: number

  constructor(previousHash: string | null = null, config: AmsVansClassifiedsConfig = {}) {
    this.previousHash = previousHash
    this.previousPage1Hash = config.previousPage1Hash ?? null
    this.robotsCache = config.robotsCache ?? new RobotsCache()
    this.fetchPage = config.fetchPage ?? defaultFetchPage
    this.detailFetchDelayMs = config.detailFetchDelayMs ?? DEFAULT_DETAIL_FETCH_DELAY_MS
    this.maxListings = config.maxListings ?? Infinity
  }

  private async fetchAllowed(url: string, context?: JobContext, logPrefix?: string): Promise<FetchResult | null> {
    const allowed = await this.robotsCache.isAllowed(url, USER_AGENT)
    if (!allowed) {
      await report(context, `${logPrefix ?? '[ams-vans-classifieds]'} robots.txt disallows ${url} — skipping`, {
        stage: 'scraping',
        source: SOURCE_ID,
        reason: 'robots_disallowed',
      })
      return null
    }
    return this.fetchPage(url)
  }

  async checkPage1(): Promise<Page1CheckResult> {
    const sitemapVins = await this.fetchSitemapVins()
    const currentHash = hashPage1Entries(sitemapVins)
    const changed = this.previousPage1Hash === null || this.previousPage1Hash !== currentHash
    return { currentHash, changed }
  }

  async checkStructure(): Promise<StructureCheckResult> {
    const sitemapVins = await this.fetchSitemapVins()
    // fetchSitemapVins() throws rather than returning an empty array (see its
    // doc comment) — there is always at least one VIN here to sample.
    const firstVin = sitemapVins[0]!

    const result = await this.fetchPage(`${BASE_URL}${CLASSIFIEDS_SITEMAP_PATH}${firstVin}`)
    const parsed = parseDetailPageHtml(result.text)
    const signature = parsed.record
      ? `type:${parsed.pageType}|keys:${Object.keys(parsed.record).sort().join(',')}`
      : `type:${parsed.pageType}|no-record`

    const currentHash = createHash('sha256').update(signature).digest('hex')
    const changed = this.previousHash !== null && this.previousHash !== currentHash
    return {
      changed,
      currentHash,
      previousHash: this.previousHash,
      ...(changed ? { sampleHtml: result.text } : {}),
    }
  }

  async scrape(context?: JobContext): Promise<ScrapeResult> {
    const listings: Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'>[] = []

    await report(context, '[ams-vans-classifieds] Fetching sitemap for classified-ad URLs', {
      stage: 'scraping',
      source: SOURCE_ID,
      listings: 0,
    })

    const vins = (await this.fetchSitemapVins()).slice(0, this.maxListings)

    await report(context, `[ams-vans-classifieds] Sitemap listed ${vins.length} classified ad(s)`, {
      stage: 'scraping',
      source: SOURCE_ID,
      listings: 0,
    })

    for (let i = 0; i < vins.length; i++) {
      const vin = vins[i]!
      const detailUrl = `${BASE_URL}${CLASSIFIEDS_SITEMAP_PATH}${vin}`

      const result = await this.fetchAllowed(detailUrl, context, '[ams-vans-classifieds]')
      if (result === null) continue

      if (result.status === 404) {
        await report(context, `[ams-vans-classifieds] ${detailUrl} is gone (404) — skipping`, {
          stage: 'scraping',
          source: SOURCE_ID,
          reason: 'not_found',
        })
      } else {
        const parsed = parseDetailPageHtml(result.text)
        const listing = parsed.pageType === 'Classified' && parsed.record
          ? buildListing(parsed.record, result.url)
          : null

        if (listing) {
          listings.push(listing)
        } else {
          await report(context, `[ams-vans-classifieds] Could not parse a classified record at ${detailUrl}`, {
            stage: 'scraping',
            source: SOURCE_ID,
            reason: 'unparseable_record',
          })
        }
      }

      if ((i + 1) % 25 === 0 || i === vins.length - 1) {
        await report(context, `[ams-vans-classifieds] Fetched ${i + 1}/${vins.length} detail page(s); ${listings.length} listing(s) so far`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: i + 1,
          listings: listings.length,
        })
      }

      if (i < vins.length - 1) await jitteredSleep(this.detailFetchDelayMs)
    }

    const fingerprintHash = createHash('sha256')
      .update(listings.map(l => l.vin ?? l.sourceUrl).join('|'))
      .digest('hex')

    return { listings, fingerprintHash }
  }

  /**
   * Fetches the sitemap and returns the VINs of every classified-ad URL it
   * lists, in document order. Throws — rather than returning `[]` — on a
   * robots.txt disallow, a non-200 response, or a parsed-but-empty VIN list:
   * this board reliably lists ~200 live ads, so an empty result is far more
   * likely to be a transient error page, a redirect to a login/interstitial
   * page, or an upstream layout change than the board being genuinely empty.
   * Letting `scrape()` return `{ listings: [] }` in that case would report a
   * "complete" zero-listing crawl to the engine, which marks every existing
   * listing gone (see ScraperEngine.runSource's markGone call) — throwing
   * instead routes the run through markError/runs.fail, matching how the
   * other adapters in this package treat a failed listing-page fetch.
   */
  private async fetchSitemapVins(): Promise<string[]> {
    const allowed = await this.robotsCache.isAllowed(SITEMAP_URL, USER_AGENT)
    if (!allowed) {
      throw new Error(`[ams-vans-classifieds] robots.txt disallows ${SITEMAP_URL} — cannot discover any listings`)
    }

    const result = await this.fetchPage(SITEMAP_URL)
    if (result.status !== 200) {
      throw new Error(`[ams-vans-classifieds] Sitemap fetch failed: HTTP ${result.status} for ${SITEMAP_URL}`)
    }

    const vins = extractClassifiedVinsFromSitemap(result.text)
    if (vins.length === 0) {
      throw new Error(`[ams-vans-classifieds] Sitemap at ${SITEMAP_URL} listed zero classified-ad URLs`)
    }

    return vins
  }
}

export function hashPage1Entries(entries: string[]): string {
  return createHash('sha256').update([...entries].sort().join(',') || 'empty').digest('hex')
}

/**
 * Extracts VINs from `<loc>` entries matching the classifieds path. The
 * sitemap also lists AMS's own dealer-inventory pages
 * (`/wheelchair-vans/{stockNumber}`) and a couple of non-listing utility
 * entries — everything other than the classifieds path is ignored.
 */
export function extractClassifiedVinsFromSitemap(xml: string): string[] {
  const vins: string[] = []
  const locPattern = /<loc>([^<]*)<\/loc>/g
  let match: RegExpExecArray | null
  while ((match = locPattern.exec(xml)) !== null) {
    const loc = match[1] ?? ''
    const idx = loc.indexOf(CLASSIFIEDS_SITEMAP_PATH)
    if (idx === -1) continue
    const vin = loc.slice(idx + CLASSIFIEDS_SITEMAP_PATH.length).replace(/\/+$/, '').trim()
    if (vin) vins.push(vin)
  }
  return vins
}

/** Extracts and parses the Next.js `__NEXT_DATA__` JSON payload embedded in a server-rendered page. */
export function extractNextData(html: string): unknown | null {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Parses a detail page's HTML into its page type and (when present) classified record. */
export function parseDetailPageHtml(html: string): ParsedDetailPage {
  const nextData = asRecord(extractNextData(html))
  const page = asRecord(asRecord(nextData?.['props'])?.['pageProps'])?.['page']
  const pageRecord = asRecord(page)
  const pageType = stringOrNull(pageRecord?.['type'])
  const cl = asRecord(asRecord(pageRecord?.['data'])?.['cl'])

  if (!cl) return { pageType, record: null }

  const vin = stringOrNull(cl['vin'])
  const year = numberOrNull(cl['year'])
  const make = stringOrNull(cl['make'])
  const model = stringOrNull(cl['model'])
  if (!vin || year === null || !make || !model) return { pageType, record: null }

  const images = Array.isArray(cl['images'])
    ? cl['images'].filter((v): v is string => typeof v === 'string')
    : []

  return {
    pageType,
    record: {
      vin,
      zip: stringOrNull(cl['zip']),
      price: numberOrNull(cl['price']),
      year,
      make,
      model,
      trim: stringOrNull(cl['trim']),
      mileage: numberOrNull(cl['mileage']),
      transmission: stringOrNull(cl['transmission']),
      color: stringOrNull(cl['color']),
      details: stringOrNull(cl['details']),
      images,
      conv_make: stringOrNull(cl['conv_make']),
      conv_location: stringOrNull(cl['conv_location']),
      conv_type: stringOrNull(cl['conv_type']),
      conv_wheelchairs: numberOrNull(cl['conv_wheelchairs']),
      approved: numberOrNull(cl['approved']) ?? 0,
      deleted: numberOrNull(cl['deleted']) ?? 0,
      last_updated: numberOrNull(cl['last_updated']),
    },
  }
}

/** Normalizes a protocol-relative image URL (`//host/path`) to `https:`. Absolute URLs pass through unchanged. */
export function normalizeImageUrl(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url
}

export function parseConversionType(conversionLocation: string | null): ConversionType {
  const t = (conversionLocation ?? '').toLowerCase()
  if (t.includes('rear')) return 'rear_entry'
  if (t.includes('side')) return 'side_entry'
  return 'unknown'
}

export function parseRampType(conversionType: string | null): RampType {
  const t = (conversionType ?? '').toLowerCase()
  if (t.includes('in-floor') || t.includes('in floor')) return 'in_floor'
  if (t.includes('fold-out') || t.includes('fold out')) return 'fold_out'
  if (t.includes('fold-in') || t.includes('fold in')) return 'fold_in'
  return 'unknown'
}

export function parseConversionManufacturer(convMake: string | null): string | null {
  const key = (convMake ?? '').trim().toLowerCase()
  return key ? KNOWN_MANUFACTURER_MAP[key] ?? null : null
}

/**
 * Builds a normalized Listing from a parsed classified record. Returns null
 * when the record is not currently a live, approved, non-deleted ad — this
 * adapter treats those states as "not a listing" rather than surfacing a
 * partially-published record. `sourceRecordKey`/`buyerUrl` route back to the
 * source (the referral posture from #972) rather than to any republished
 * contact information.
 */
export function buildListing(raw: ClassifiedRecord, detailUrl: string): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  if (raw.approved !== 1 || raw.deleted !== 0) return null

  const normalizedVin = normalizeVin(raw.vin)
  const qualityIssueCodes: string[] = []
  let vin: string | null
  if (!isValidVin(normalizedVin)) {
    vin = null
    qualityIssueCodes.push('unparseable_vin')
  } else if (!checkDigitValid(normalizedVin)) {
    vin = normalizedVin
    qualityIssueCodes.push('invalid_check_digit')
  } else {
    vin = normalizedVin
  }

  // Every ad on this board is a classified listing submitted directly by its
  // seller — there is no separate "AMS's own inventory" record type mixed
  // into these detail pages (that lives under /wheelchair-vans/used instead,
  // a different page entirely). A minority of ads are placed by small
  // third-party dealers rather than individual owners (see #998's PR
  // description), but the source gives no explicit field to distinguish
  // them, so — matching how this board is understood by its own users, and
  // consistent with the "majority, not exclusively, private-seller"
  // character the issue anticipated — every ad here defaults to 'private'.
  const sellerType = 'private' as const

  const images = raw.images
    .map(normalizeImageUrl)
    .filter(isVehicleImageUrl)

  const sourceUrl = detailUrl
  const sourceRecordKey = vin ?? normalizeSourceUrl(sourceUrl)

  return {
    sourceId: SOURCE_ID,
    sourceUrl,
    buyerUrl: sourceUrl,
    externalId: vin,
    stockNumber: null,
    sourceRecordKey,
    make: raw.make,
    model: raw.model,
    year: raw.year,
    trim: raw.trim,
    vin,
    condition: 'used',
    sellerType,
    priceCents: raw.price !== null && raw.price > 0 ? Math.round(raw.price * 100) : null,
    mileage: raw.mileage,
    color: raw.color,
    fuelType: null,
    transmission: raw.transmission,
    wav: {
      conversionType: parseConversionType(raw.conv_location),
      conversionManufacturer: parseConversionManufacturer(raw.conv_make),
      floorLoweringInches: null,
      rampType: parseRampType(raw.conv_type),
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: raw.conv_wheelchairs !== null && raw.conv_wheelchairs > 0 ? raw.conv_wheelchairs : null,
    },
    // The seller submits their own zip; AMS Vans (the platform) has no fixed
    // dealer location for these ads, unlike a single-location adapter such as
    // Freedom Motors.
    location: { zip: raw.zip, city: null, state: null, lat: null, lng: null },
    // Deliberately no seller name/phone/website: the source's only seller
    // identity field is a personal email address, which this adapter never
    // reads (see ClassifiedRecord's doc comment). Buyers reach the seller via
    // buyerUrl, matching the #972 referral posture.
    dealer: { name: null, phone: null, website: null },
    images,
    description: raw.details,
    ...(qualityIssueCodes.length > 0 ? { qualityIssueCodes } : {}),
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date(),
    sourceListedAt: null,
    sourceUpdatedAt: raw.last_updated !== null ? new Date(raw.last_updated * 1000) : null,
  }
}

/** Strip query string and trailing slash for a stable URL-based record key. */
export function normalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`.replace(/\/$/, '')
  } catch {
    return url
  }
}
