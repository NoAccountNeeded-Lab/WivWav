import type { Meilisearch } from 'meilisearch'
import type { Listing, PrismaClient } from '@wivwav/db'
import {
  canonicalColor,
  canonicalFuelType,
  canonicalMake,
  canonicalModel,
  canonicalConversionManufacturer,
  conversionBrandSlug,
} from './canonicalize.js'

/**
 * Counts non-null optional fields as a data completeness score for a listing.
 * Higher is better. Used to rank candidates when selecting a representative
 * listing per verified vehicle group (refs #530).
 */
export function listingCompletenessScore(listing: Listing): number {
  const optionalFields: (keyof Listing)[] = [
    'trim',
    'vin',
    'priceCents',
    'mileage',
    'color',
    'fuelType',
    'transmission',
    'conversionManufacturer',
    'floorLoweringInches',
    'wheelchairCapacity',
    'zip',
    'city',
    'state',
    'lat',
    'lng',
    'dealerName',
    'dealerPhone',
    'dealerWebsite',
    'description',
    'detailScrapedAt',
  ]
  return optionalFields.filter((f) => listing[f] != null).length + (listing.images as string[]).length
}

/**
 * Deterministic grouping key: verified vehicle groups share `vehicleId`;
 * everything else is its own singleton group keyed by its own `id`. Shared
 * between the incremental (`syncListings`) and full-rebuild sync paths so
 * both agree on group membership for the same listing.
 */
export function groupKeyOf(row: Pick<Listing, 'id' | 'vehicleId'>): string {
  return row.vehicleId ?? row.id
}

/**
 * Selects the deterministic representative listing from a set of eligible
 * listings in a verified vehicle group.
 *
 * Ranking (all descending except id):
 *  1. Completeness score — more non-null fields wins
 *  2. `scrapedAt` freshness — more recent wins
 *  3. Listing `id` — lexicographic ascending tie-breaker (stable across runs)
 *
 * The caller is responsible for ensuring `listings` is non-empty and that all
 * entries are eligible (active + publicationStatus eligible).
 */
export function selectRepresentative(listings: Listing[]): Listing {
  return [...listings].sort((a, b) => {
    const scoreDiff = listingCompletenessScore(b) - listingCompletenessScore(a)
    if (scoreDiff !== 0) return scoreDiff
    const freshnessDiff = b.scrapedAt.getTime() - a.scrapedAt.getTime()
    if (freshnessDiff !== 0) return freshnessDiff
    // Stable tie-breaker: lexicographic ascending id
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]!
}

export {
  canonicalColor,
  canonicalFuelType,
  canonicalMake,
  canonicalModel,
  canonicalConversionManufacturer,
  conversionBrandSlug,
  ENGINE_DESCRIPTION_PATTERN,
  matchMultiWordModelTokenCount,
  MULTI_WORD_MODEL_FIRST_TOKENS,
  AMBIGUOUS_MULTI_WORD_MODEL_FIRST_TOKENS,
} from './canonicalize.js'
export type { CanonicalFuelType } from './canonicalize.js'

export const INDEX_NAME = 'listings'

/**
 * Configure a Meilisearch index with the listings-index settings.
 * Parameterized by `indexName` so both the live index (API startup, a no-op
 * settings refresh) and a versioned rebuild target (full-rebuild swap, #669)
 * share one settings definition instead of drifting apart.
 *
 * `updateSettings` implicitly creates the index if `indexName` does not yet
 * exist, so this also serves as "create and configure" for a fresh index.
 */
export async function configureIndexSettings(client: Meilisearch, indexName: string): Promise<void> {
  const index = client.index(indexName)
  const task = await index.updateSettings({
    filterableAttributes: [
      'make', 'model', 'year', 'trim', 'condition', 'sellerType',
      'conversionType', 'rampType', 'wavFeatures',
      'conversionBrand', 'color', 'state', 'city', 'sourceId',
      'priceCents', 'priceBucket', 'mileage', 'mileageBucket', 'status', 'saleStatus',
      'publicationStatus', 'vehicleId', 'vehicleGroupKey',
    ],
    sortableAttributes: ['priceCents', 'mileage', 'year', 'listedAt'],
    pagination: { maxTotalHits: 20000 },
    searchableAttributes: [
      'make', 'model', 'trim', 'description',
      'conversionManufacturer', 'city', 'state',
    ],
    distinctAttribute: 'vehicleGroupKey',
  })
  const result = await client.tasks.waitForTask(task.taskUid, { timeout: 15_000 })
  if (result.status !== 'succeeded') {
    throw new Error(`Meilisearch settings update failed on "${indexName}": task ${result.uid} ended with status ${result.status}`)
  }
}

/** True when `indexName` currently exists on the Meilisearch instance. */
export async function indexExists(client: Meilisearch, indexName: string): Promise<boolean> {
  try {
    await client.getRawIndex(indexName)
    return true
  } catch {
    return false
  }
}

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
  /**
   * #499 field-resolution status. `conversionType`/`rampType` above already
   * read `unknown` while conflicting (see apps/scraper/src/resolution),
   * which is what actually drives side/rear/ramp filter exclusion — these
   * are exposed only so ops tooling and result cards can show *why* a value
   * reads unknown without a second Postgres round-trip. Not filterable.
   */
  conversionTypeResolution: string
  rampTypeResolution: string
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

export function priceBucket(priceCents: number | null, bucketSizeDollars = 5000): string | null {
  if (priceCents == null) return null
  const dollars = priceCents / 100
  const lo = Math.floor(dollars / bucketSizeDollars) * bucketSizeDollars
  return `${lo}-${lo + bucketSizeDollars}`
}

export function mileageBucket(mileage: number | null, bucketSize = 12000): string | null {
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
  // engine is the raw engine description; fuelType may be an engine description on legacy rows
  // from BLVD before the engine/fuelType separation was introduced (pre-#515 backfill).
  const canonFuelType = canonicalFuelType(row.fuelType, row.engine ?? null)
  const canonConverter = canonicalConversionManufacturer(row.conversionManufacturer)

  return {
    id: row.id,
    vehicleId: row.vehicleId,
    vehicleGroupKey: groupKeyOf(row),
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
    conversionTypeResolution: row.conversionTypeResolution,
    rampTypeResolution: row.rampTypeResolution,
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

/**
 * Incrementally syncs a set of touched listing IDs to Meilisearch.
 *
 * For verified vehicle groups (listings with a shared `vehicleId`): fetches
 * all eligible listings in the group (not just the touched ones) and uploads
 * only the deterministic representative, removing all non-representative group
 * members from the index. This ensures that touching any listing in a group
 * recomputes group representation correctly.
 *
 * For ungrouped listings (no `vehicleId`): each eligible listing is synced
 * individually so candidates (not yet verified) remain separately searchable.
 *
 * Ineligible IDs (not active or not eligible) are deleted from the index.
 */
export async function syncListings(
  listingIds: string[],
  db: PrismaClient,
  client: Meilisearch,
): Promise<void> {
  if (listingIds.length === 0) return

  // 1. Fetch the touched listings (any status/publication) to discover vehicleIds.
  const touchedRows = await db.listing.findMany({
    where: { id: { in: listingIds } },
    select: { id: true, vehicleId: true },
  })

  // Collect vehicleIds for all touched listings that belong to a verified group.
  const touchedVehicleIds = new Set<string>()
  for (const row of touchedRows) {
    if (row.vehicleId) touchedVehicleIds.add(row.vehicleId)
  }

  // 2. Fetch all eligible listings for those vehicle groups (full groups needed
  //    to pick the correct representative, not just the touched subset).
  const groupRows =
    touchedVehicleIds.size > 0
      ? await db.listing.findMany({
          where: {
            vehicleId: { in: [...touchedVehicleIds] },
            status: 'active',
            publicationStatus: 'eligible',
          },
        })
      : []

  // Group by vehicleId.
  const byVehicleId = new Map<string, Listing[]>()
  for (const row of groupRows) {
    const vid = row.vehicleId!
    const group = byVehicleId.get(vid)
    if (group) group.push(row)
    else byVehicleId.set(vid, [row])
  }

  // 3. Fetch eligible ungrouped listings (no vehicleId) from the touched set.
  const touchedUngroupedIds = touchedRows
    .filter((r) => !r.vehicleId)
    .map((r) => r.id)

  const ungroupedRows =
    touchedUngroupedIds.length > 0
      ? await db.listing.findMany({
          where: {
            id: { in: touchedUngroupedIds },
            status: 'active',
            publicationStatus: 'eligible',
          },
        })
      : []

  const index = client.index(INDEX_NAME)

  // 4. Build the set of documents to upsert: one representative per group +
  //    all individually-eligible ungrouped listings.
  const docsToUpsert: Listing[] = []
  const representativeIds = new Set<string>()

  for (const [, group] of byVehicleId) {
    const rep = selectRepresentative(group)
    docsToUpsert.push(rep)
    representativeIds.add(rep.id)
  }

  for (const row of ungroupedRows) {
    docsToUpsert.push(row)
  }

  if (docsToUpsert.length > 0) {
    await index.addDocuments(docsToUpsert.map(toDocument), { primaryKey: 'id' })
  }

  // 5. Build the set of IDs to delete:
  //    a) Touched IDs that are not eligible (ineligible or gone).
  const eligibleUpsertedIds = new Set(docsToUpsert.map((r) => r.id))
  // Includes ineligible listings AND eligible non-representative group members.
  const touchedIdsNotUpserted = listingIds.filter((id) => !eligibleUpsertedIds.has(id))

  //    b) Non-representative members of touched vehicle groups — they may have
  //       been uploaded in a prior sync before group membership was established.
  const nonRepGroupIds = groupRows
    .filter((r) => !representativeIds.has(r.id))
    .map((r) => r.id)

  const idsToDelete = [...new Set([...touchedIdsNotUpserted, ...nonRepGroupIds])]

  if (idsToDelete.length > 0) {
    await index.deleteDocuments(idsToDelete)
  }
}
