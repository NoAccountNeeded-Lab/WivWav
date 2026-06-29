import type { Meilisearch } from 'meilisearch'
import type { Listing, PrismaClient } from '@wivwav/db'
import {
  canonicalColor,
  canonicalFuelType,
  canonicalMake,
  canonicalModel,
  canonicalConversionManufacturer,
} from './canonicalize.js'

export { canonicalColor, canonicalFuelType, canonicalMake, canonicalModel, canonicalConversionManufacturer } from './canonicalize.js'
export type { CanonicalFuelType } from './canonicalize.js'

export const INDEX_NAME = 'listings'

export interface ListingDocument {
  id: string
  vehicleId: string | null
  vehicleGroupKey: string
  sourceId: string
  sourceUrl: string
  buyerUrl: string | null
  /**
   * Canonical make from VIN decode (preferred) or source, alias-normalized.
   * Used for public facets and filtering. Raw source make is on the Listing row.
   */
  make: string
  /**
   * Canonical model from VIN decode (preferred) or source, alias-normalized.
   * Used for public facets and filtering.
   */
  model: string
  year: number
  trim: string | null
  vin: string | null
  condition: string
  sellerType: string
  priceCents: number | null
  priceBucket: string | null
  mileage: number | null
  mileageBucket: string | null
  /**
   * Canonical color for public facets — casing/suffix-collapsed, alias-normalized.
   * Derived from rawColor (preferred) or color. Raw source color is on the Listing row.
   */
  color: string | null
  /**
   * Canonical fuel type — null when only an engine description is available.
   * Engine descriptions are stored in `engine` and never exposed as fuel type.
   */
  fuelType: string | null
  transmission: string | null
  conversionType: string
  /**
   * Canonical conversion manufacturer — null when the source value is a year number,
   * generic text ("Wheelchair", "Non"), missing-value token, or dealer/source name.
   */
  conversionManufacturer: string | null
  conversionBrand: string | null
  floorLoweringInches: number | null
  rampType: string
  wavFeatures: string[]
  wheelchairCapacity: number | null
  zip: string | null
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
  dealerName: string | null
  dealerPhone: string | null
  images: string[]
  description: string | null
  status: string
  publicationStatus: string
  saleStatus: string
  listedAt: string
}

const BRAND_SLUG_ALIASES: Record<string, string> = {
  ams: 'ams-vans',
  'ams-and-vans': 'ams-vans',
  freedom: 'freedom-motors',
  rollx: 'rollx-vans',
  vantage: 'vantage-mobility',
  'vantage-mobility-international': 'vantage-mobility',
}

export function conversionBrandSlug(value: string | null | undefined): string | null {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!slug) return null

  return BRAND_SLUG_ALIASES[slug] ?? slug
}

export function priceBucket(priceCents: number | null, bucketSizeDollars = 5000): string | null {
  if (priceCents == null) return null
  const dollars = priceCents / 100
  const lo = Math.floor(dollars / bucketSizeDollars) * bucketSizeDollars
  return `${lo}-${lo + bucketSizeDollars}`
}

export function mileageBucket(mileage: number | null, bucketSize = 25000): string | null {
  if (mileage == null) return null
  const lo = Math.floor(mileage / bucketSize) * bucketSize
  return `${lo}-${lo + bucketSize}`
}

export function toDocument(row: Listing): ListingDocument {
  const isPrivate = row.sellerType === 'private'
  // Suppress personal phone numbers; normalize name to a generic label for private sellers.
  // Both are personal data under CCPA/state privacy laws; dealer equivalents are business info.
  const dealerPhone = isPrivate ? null : row.dealerPhone
  const dealerName = isPrivate ? 'For Sale By Owner' : row.dealerName

  // Canonical fields — derived from raw source values via pure canonicalization functions.
  // Raw values remain on the DB row for provenance; search/facets use only canonical values.
  const canonMake = canonicalMake(null, row.make) ?? row.make
  const canonModel = canonicalModel(null, row.model) ?? row.model
  // color stores the raw source color for provenance; canonicalColor derives the facet value
  const canonColor = canonicalColor(row.color)
  // engine is the raw engine description (new field); fuelType may be an engine description
  // on legacy rows from BLVD before the engine/fuelType separation was introduced.
  const engineSource = (row as Listing & { engine?: string | null }).engine
  const canonFuelType = canonicalFuelType(row.fuelType, engineSource ?? null)
  const canonConverter = canonicalConversionManufacturer(row.conversionManufacturer, null)

  return {
    id: row.id,
    vehicleId: row.vehicleId,
    vehicleGroupKey: row.vehicleId ?? row.id,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    buyerUrl: row.buyerUrl,
    make: canonMake,
    model: canonModel,
    year: row.year,
    trim: row.trim,
    vin: row.vin,
    condition: row.condition,
    sellerType: row.sellerType,
    priceCents: row.priceCents,
    priceBucket: priceBucket(row.priceCents),
    mileage: row.mileage,
    mileageBucket: mileageBucket(row.mileage),
    color: canonColor,
    fuelType: canonFuelType,
    transmission: row.transmission,
    conversionType: row.conversionType,
    conversionManufacturer: canonConverter,
    conversionBrand: conversionBrandSlug(canonConverter),
    floorLoweringInches: row.floorLoweringInches,
    rampType: row.rampType,
    wavFeatures: row.wavFeatures as string[],
    wheelchairCapacity: row.wheelchairCapacity,
    zip: row.zip,
    city: row.city,
    state: row.state,
    lat: row.lat,
    lng: row.lng,
    dealerName,
    dealerPhone,
    images: row.images,
    description: row.description,
    status: row.status,
    publicationStatus: row.publicationStatus,
    saleStatus: row.saleStatus,
    listedAt: row.listedAt.toISOString(),
  }
}

export async function syncListings(
  listingIds: string[],
  db: PrismaClient,
  client: Meilisearch,
): Promise<void> {
  if (listingIds.length === 0) return
  const rows = await db.listing.findMany({
    where: {
      id: { in: listingIds },
      status: 'active',
      publicationStatus: 'eligible',
    },
  })
  const eligibleIds = new Set(rows.map(row => row.id))
  const idsToRemove = listingIds.filter(id => !eligibleIds.has(id))
  const index = client.index(INDEX_NAME)

  if (rows.length > 0) {
    await index.addDocuments(rows.map(toDocument), { primaryKey: 'id' })
  }
  if (idsToRemove.length > 0) {
    await index.deleteDocuments(idsToRemove)
  }
}
