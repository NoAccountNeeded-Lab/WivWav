import { createHash } from 'node:crypto'
import type { ConversionType, Listing, ListingCondition, ListingSellerType, RampType } from '@wivwav/types'
import { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/types'
import { isVehicleImageUrl } from './image-filter.js'
import { parseVehicleTitle } from '../lib/parse-vehicle-title.js'
import { SOURCE_ID } from './mobility-van-sales-constants.js'

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
