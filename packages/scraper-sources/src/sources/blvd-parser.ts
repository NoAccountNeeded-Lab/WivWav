import { createHash } from 'node:crypto'
import type { ConversionType, Listing, ListingCondition } from '@wivwav/types'
import { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/types'
import type { BrowserPage } from '../browser/index.js'
import type { CrawledHtmlPage } from '../crawlee/html-fetcher.js'
import { parseVehicleTitle } from '../lib/parse-vehicle-title.js'
import { BASE_URL, CARD_SEL, SOURCE_ID } from './blvd-constants.js'

type CheerioAPI = CrawledHtmlPage['$']

// Shape returned from page.evaluate — must be JSON-serializable.
export interface RawCard {
  href: string
  fullTitle: string // "2024 Toyota Sienna FWD XLE" from desktop h3
  conversion: string // "Driverge Flex Maxx Wheelchair Van Conversion"
  condition: string // "Used" | "New" from Vehicle Condition indicator, or "" when absent
  miles: string // "50,094"
  price: string // "$71,991" | "Call" | ""
  seller: string // "MobilityWorks"
  location: string // "North Las Vegas, NV"
  imageUrl: string
  dataId: string
}

export async function evaluateBlvdCards(page: BrowserPage): Promise<RawCard[]> {
  return page.evaluate(
    function ({ sel, baseUrl }: { sel: string; baseUrl: string }): RawCard[] {
      const results: RawCard[] = []

      document.querySelectorAll(sel).forEach(function (card) {
        const detailLink = card.querySelector('a.more-van-details-btn') as HTMLAnchorElement | null
        const href = detailLink?.getAttribute('href') ?? ''

        const h3s = Array.from(card.querySelectorAll('h3'))
        const fullTitleH3 = h3s.find(function (h) {
          return /^\d{4}\s/.test(h.textContent?.trim() ?? '')
        })
        const fullTitle = fullTitleH3?.textContent?.trim() ?? ''

        const conversion = card.querySelector('h4.conversion')?.textContent?.trim() ?? ''
        const condEl = card.querySelector(
          '.newusedicon[data-title="Vehicle Condition"]',
        ) as HTMLElement | null
        const condition = condEl === null ? '' : condEl.classList.contains('Used') ? 'Used' : 'New'

        const fields: Record<string, string> = {}
        card.querySelectorAll('div.vlistp').forEach(function (label) {
          const h4 = label.nextElementSibling
          if (h4?.tagName === 'H4') {
            fields[label.textContent?.trim() ?? ''] = h4.textContent?.trim() ?? ''
          }
        })

        const imgEl = card.querySelector('img.img-responsive') as HTMLImageElement | null
        const imgSrc = imgEl?.getAttribute('src') ?? ''
        const imageUrl = imgSrc.startsWith('http') ? imgSrc : imgSrc ? `${baseUrl}${imgSrc}` : ''

        results.push({
          href,
          fullTitle,
          conversion,
          condition,
          miles: fields['Miles'] ?? '',
          price: fields['Price'] ?? '',
          seller: fields['Seller'] ?? '',
          location: fields['Loc.'] ?? '',
          imageUrl,
          dataId: card.getAttribute('data-id') ?? '',
        })
      })

      return results
    },
    { sel: CARD_SEL, baseUrl: BASE_URL },
  )
}

export function extractBlvdCards($: CheerioAPI): RawCard[] {
  return $(CARD_SEL).toArray().map((element) => {
    const card = $(element)
    const fields: Record<string, string> = {}
    card.find('div.vlistp').each((_index, label) => {
      const next = $(label).next('h4')
      if (next.length) fields[$(label).text().trim()] = next.text().trim()
    })
    const condition = card.find('.newusedicon[data-title="Vehicle Condition"]').first()
    const src = card.find('img.img-responsive').first().attr('src') ?? ''
    return {
      href: card.find('a.more-van-details-btn').first().attr('href') ?? '',
      fullTitle: card.find('h3').toArray().map((h) => $(h).text().trim())
        .find((title) => /^\d{4}\s/.test(title)) ?? '',
      conversion: card.find('h4.conversion').first().text().trim(),
      condition: condition.length === 0 ? '' : condition.hasClass('Used') ? 'Used' : 'New',
      miles: fields['Miles'] ?? '',
      price: fields['Price'] ?? '',
      seller: fields['Seller'] ?? '',
      location: fields['Loc.'] ?? '',
      imageUrl: src.startsWith('http') ? src : src ? `${BASE_URL}${src}` : '',
      dataId: card.attr('data-id') ?? '',
    }
  })
}

export function extractBlvdStructure($: CheerioAPI): { signature: string; cardHtml: string } {
  const cards = $(CARD_SEL)
  const first = cards.first()
  if (!first.length) return { signature: 'no-cards', cardHtml: '' }
  const parts: string[] = []
  const stack = [{ element: first, depth: 0 }]
  while (stack.length > 0) {
    const item = stack.pop()
    if (!item || item.depth > 3) continue
    parts.push(`${item.element.prop('tagName')?.toUpperCase()}[${item.element.attr('class') ?? ''}]`)
    const children = item.element.children().toArray()
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child) stack.push({ element: $(child), depth: item.depth + 1 })
    }
  }
  return { signature: `count:${cards.length}|${parts.join(',')}`, cardHtml: $.html(first) }
}

export function hasBlvdNextPage($: CheerioAPI): boolean {
  return $('a').toArray().some((a) => $(a).text().trim() === 'Next')
}
export function hashPage1Entries(entries: string[]): string {
  return createHash('sha256')
    .update(entries.sort().join(',') || 'empty')
    .digest('hex')
}


export function parseCard(raw: RawCard): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  // Condition must be determinable — skip cards where the selector was absent to
  // avoid fabricating a 'new' value for vehicles that are actually used.
  if (raw.condition === '') return null

  // "2024 Toyota Sienna FWD XLE" → year, make, model, trim
  const { year, make, model, trim } = parseVehicleTitle(raw.fullTitle)

  if (!make || !model || year < 1990 || year > new Date().getFullYear() + 2) return null

  // Require a valid href — without it there is no source URL to use as a record key.
  if (!raw.href) return null

  // VIN: last path segment from the detail link.
  // Normalize: uppercase + strip non-alphanumeric display characters (e.g. hyphens).
  // Classify the result and record quality codes for downstream quarantine.
  const rawVinSegment = raw.href.split('/').pop() ?? ''
  const normalizedVin = normalizeVin(rawVinSegment)
  const qualityIssueCodes: string[] = []

  let vin: string | null
  if (!isValidVin(normalizedVin)) {
    // Wrong length or forbidden characters (I/O/Q) — not a plausible VIN.
    // Store null rather than a garbage string; mark for quarantine review.
    vin = null
    qualityIssueCodes.push('unparseable_vin')
  } else if (!checkDigitValid(normalizedVin)) {
    // Structural check passed but North American check-digit fails.
    // Retain the VIN (non-NA VINs may legitimately fail) but flag for review.
    // Rule id matches listing-validator.ts's invalid_check_digit rule, which
    // re-checks the same condition during publication — keeping the id in sync
    // means a source-level pre-check and the canonical validator never disagree
    // on what to call the same failure.
    vin = normalizedVin
    qualityIssueCodes.push('invalid_check_digit')
  } else {
    vin = normalizedVin
  }

  const mileage = parseMileage(raw.miles)
  const priceCents = parsePrice(raw.price)

  const locationParts = raw.location.split(',').map((s) => s.trim())
  const city = locationParts[0] || null
  const state = locationParts[1] || null

  const condition: ListingCondition = raw.condition === 'New' ? 'new' : 'used'
  const conversionType = parseConversionType(raw.conversion)
  const conversionManufacturer = parseConversionManufacturer(raw.conversion)

  const sourceUrl = raw.href.startsWith('http') ? raw.href : `${BASE_URL}${raw.href}`
  const isPrivateSeller = /^for sale by owner$/i.test(raw.seller.trim())
  const externalId = raw.dataId || null

  return {
    sourceId: SOURCE_ID,
    sourceUrl,
    buyerUrl: sourceUrl,
    externalId,
    stockNumber: null,
    sourceRecordKey: externalId ?? normalizeSourceUrl(sourceUrl),
    make,
    model,
    year,
    trim,
    vin,
    condition,
    sellerType: isPrivateSeller ? 'private' : 'dealer',
    priceCents,
    mileage,
    color: null,
    fuelType: null,
    transmission: null,
    wav: {
      conversionType,
      conversionManufacturer,
      floorLoweringInches: null,
      rampType: 'unknown',
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: { zip: null, city, state, lat: null, lng: null },
    dealer: { name: raw.seller || null, phone: null, website: null },
    images: raw.imageUrl ? [raw.imageUrl] : [],
    description: null,
    ...(qualityIssueCodes.length > 0 ? { qualityIssueCodes } : {}),
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date(),
    sourceListedAt: null,
    sourceUpdatedAt: null,
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

export function parseMileage(text: string): number | null {
  const m = text.replace(/,/g, '').match(/(\d+)/)
  return m ? parseInt(m[1]!, 10) : null
}

export function parsePrice(text: string): number | null {
  const m = text.replace(/,/g, '').match(/(\d+)/)
  return m ? parseInt(m[1]!, 10) * 100 : null
}

export function parseConversionType(text: string): ConversionType {
  const t = text.toLowerCase()
  if (t.includes('rear entry') || t.includes('rear-entry')) return 'rear_entry'
  if (t.includes('side entry') || t.includes('side-entry')) return 'side_entry'
  return 'unknown'
}

// BLVD's `conversion` card field mixes two unrelated kinds of text: entry-style
// descriptions ("Side Entry", "Rear Entry Manual Fold Out") and, on some cards,
// a manufacturer-led product name ("Driverge Flex Maxx Wheelchair Van
// Conversion"). Blindly returning the first word conflated the two and leaked
// facet/filter noise ("Yes", "FR", "AT", "Side", "Commercial", "Triple",
// "Adaptive", "Other", "Passenger", "Rear", "Regular", "See", …) into the
// public conversionBrand facet (refs #603).
//
// Sorted longest-first so a full name (e.g. "All Terrain Conversions") wins
// over a shorter one that happens to be a prefix of it.
const KNOWN_CONVERTER_PREFIXES = [
  'BraunAbility',
  'Braun',
  'Vantage Mobility International',
  'Vantage Mobility',
  'Vantage',
  'Freedom Motors',
  'Rollx Vans',
  'Rollx',
  'AMS Vans',
  'VMI',
  'MobilityWorks',
  'Mobility Works',
  'Driverge',
  'All Terrain Conversions',
  'ATC',
  'ATS',
  'Tempest',
  'Ryno',
  'Eldorado',
  'Revability',
  'Revabilty',
  'MV-1',
  'MV1',
  'Northstar',
  'Entervan',
].sort((a, b) => b.length - a.length)

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Precompiled once at module load — parseConversionManufacturer runs per card
// during scraping, so building a fresh RegExp per prefix per call is wasted work.
const KNOWN_CONVERTER_PREFIX_PATTERNS: Array<{ name: string; pattern: RegExp }> =
  KNOWN_CONVERTER_PREFIXES.map((name) => ({
    name,
    pattern: new RegExp(`^${escapeRegExp(name)}(?:\\b|$)`, 'i'),
  }))

/**
 * Recognizes a known conversion-manufacturer name at the start of the
 * `conversion` card field. Returns null when no known name is recognized —
 * callers must not fall back to guessing from the first word, since this
 * field frequently describes entry style or uses a single generic word
 * rather than naming a manufacturer. New real converters observed in this
 * field should be added to KNOWN_CONVERTER_PREFIXES (and the matching
 * @wivwav/search KNOWN_CONVERTERS / curated conversion_brands seed entry)
 * once verified, rather than reintroducing a first-word guess.
 */
export function parseConversionManufacturer(text: string): string | null {
  // e.g. "Driverge Driverge Flex Maxx Wheelchair Van Conversion" → cleaned to
  // "Driverge Driverge Flex Maxx", which then matches the "Driverge" prefix below.
  const cleaned = text.replace(/wheelchair van conversion/i, '').trim()
  if (!cleaned) return null

  for (const { name, pattern } of KNOWN_CONVERTER_PREFIX_PATTERNS) {
    if (pattern.test(cleaned)) return name
  }

  return null
}
