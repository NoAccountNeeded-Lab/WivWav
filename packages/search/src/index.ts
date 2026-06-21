import type { Meilisearch } from 'meilisearch'
import type { Listing, PrismaClient } from '@wivwav/db'

export const INDEX_NAME = 'listings'

export interface ListingDocument {
  id: string
  sourceId: string
  sourceUrl: string
  buyerUrl: string | null
  make: string
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
  color: string | null
  fuelType: string | null
  transmission: string | null
  conversionType: string
  conversionManufacturer: string | null
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
  saleStatus: string
  listedAt: string
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

  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    buyerUrl: row.buyerUrl,
    make: row.make,
    model: row.model,
    year: row.year,
    trim: row.trim,
    vin: row.vin,
    condition: row.condition,
    sellerType: row.sellerType,
    priceCents: row.priceCents,
    priceBucket: priceBucket(row.priceCents),
    mileage: row.mileage,
    mileageBucket: mileageBucket(row.mileage),
    color: row.color,
    fuelType: row.fuelType,
    transmission: row.transmission,
    conversionType: row.conversionType,
    conversionManufacturer: row.conversionManufacturer,
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
  const rows = await db.listing.findMany({ where: { id: { in: listingIds } } })
  await client.index(INDEX_NAME).addDocuments(rows.map(toDocument), { primaryKey: 'id' })
}
