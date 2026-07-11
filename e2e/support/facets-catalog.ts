import type { Prisma, WavFeature } from '@wivwav/db'
import { PrismaClient } from '@wivwav/db'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { apiBaseUrl, databaseUrl } from './compose.js'
import { poll } from './fixture.js'

/**
 * Controlled catalog for the Discover facets browser suite (#641).
 *
 * Seeded directly as already-canonical database rows (colors, ramp types and
 * conversion manufacturers that canonicalize.ts maps to themselves), so every
 * expected count below is hand-derivable from the rows alone. Exhaustive
 * count/filter correctness across aliases, dedup and lifecycle transitions is
 * the backend pipeline contract's job (#640,
 * apps/scraper/src/pipeline/fixture-to-facets.integration.test.ts); this
 * catalog only has to give the browser suite deterministic, cross-group
 * variety: every visible facet group populated, an unknown entry/ramp row, a
 * 'none' ramp row, a null-color row, a null-price row, and price/mileage
 * bucket boundaries.
 *
 * The global-setup smoke listing (e2e/support/fixture.ts, a 2024 Toyota
 * Sienna XLE: used/dealer/TX/Silver/side_entry/fold_out/VMI, $52,990,
 * 14,200 mi) stays seeded for the whole run and is COUNTED in the expected
 * manifest. `removeFacetsCatalog()` restores the exact single-listing state
 * the smoke suite asserts, so this suite must always clean up after itself.
 */

const sourceId = 'e2e-facets-source'
export const facetsListingIdPrefix = 'e2e-facets-'

/** Conversion brands curated via /v1/conversion-brands; the web UI only
 * renders brand facet values present in this table. */
const CONVERSION_BRANDS = [
  { name: 'BraunAbility', slug: 'braunability' },
  { name: 'VMI', slug: 'vmi' },
] as const

const listedAt = new Date('2026-01-10T12:00:00.000Z')

type RowOverrides = {
  n: number
  make: string
  model: string
  year: number
  trim: string
  condition: 'used' | 'new'
  sellerType: 'dealer' | 'private'
  priceCents: number | null
  mileage: number
  color: string | null
  state: string
  conversionType: 'side_entry' | 'rear_entry' | 'unknown'
  conversionManufacturer: string | null
  rampType: 'fold_out' | 'in_floor' | 'fold_in' | 'none' | 'unknown'
  wavFeatures: WavFeature[]
}

function row(o: RowOverrides): Prisma.ListingUncheckedCreateInput {
  const id = `${facetsListingIdPrefix}${o.n}`
  return {
    id,
    sourceId,
    sourceUrl: `https://example.com/${id}`,
    buyerUrl: null,
    externalId: id,
    stockNumber: `E2E-FCT-${o.n}`,
    sourceRecordKey: id,
    make: o.make,
    model: o.model,
    year: o.year,
    trim: o.trim,
    vin: `5TDYRKEC0RS10000${o.n}`,
    condition: o.condition,
    sellerType: o.sellerType,
    priceCents: o.priceCents,
    mileage: o.mileage,
    color: o.color,
    fuelType: null,
    engine: null,
    transmission: null,
    conversionType: o.conversionType,
    conversionManufacturer: o.conversionManufacturer,
    floorLoweringInches: null,
    rampType: o.rampType,
    conversionStatus: 'complete',
    wavFeatures: o.wavFeatures,
    wheelchairCapacity: 1,
    zip: null,
    city: null,
    state: o.state,
    lat: null,
    lng: null,
    vehicleId: null,
    vehicleModelId: null,
    vehicleModelMatchConfidence: null,
    dealerName: 'E2E Facets Dealer',
    dealerPhone: null,
    dealerWebsite: null,
    dealerProfileId: null,
    cardImages: [],
    images: [],
    description: `Deterministic facets-catalog listing ${o.n}.`,
    isDuplicate: false,
    canonicalId: null,
    status: 'active',
    saleStatus: 'active',
    goneAt: null,
    soldAt: null,
    publicationStatus: 'eligible',
    qualityIssueCodes: [],
    qualityCheckedAt: listedAt,
    missingFromCompleteCount: 0,
    lastSeenInCompleteCrawlAt: listedAt,
    listedAt,
    scrapedAt: listedAt,
    detailScrapedAt: listedAt,
    processingLockedAt: null,
  }
}

const CATALOG: Prisma.ListingUncheckedCreateInput[] = [
  row({
    n: 1, make: 'Chrysler', model: 'Pacifica', year: 2022, trim: 'Touring',
    condition: 'used', sellerType: 'dealer', priceCents: 4_100_000, mileage: 45_000,
    color: 'Blue', state: 'CA', conversionType: 'rear_entry',
    conversionManufacturer: 'BraunAbility', rampType: 'in_floor',
    wavFeatures: ['hand_controls'],
  }),
  row({
    n: 2, make: 'Chrysler', model: 'Pacifica', year: 2021, trim: 'Limited',
    condition: 'used', sellerType: 'private', priceCents: 3_550_000, mileage: 60_000,
    color: 'Red', state: 'TX', conversionType: 'side_entry',
    conversionManufacturer: 'VMI', rampType: 'fold_out',
    wavFeatures: ['transfer_seat', 'tie_down_system'],
  }),
  row({
    n: 3, make: 'Toyota', model: 'Sienna', year: 2023, trim: 'LE',
    condition: 'new', sellerType: 'dealer', priceCents: 6_200_000, mileage: 15,
    color: 'White', state: 'CO', conversionType: 'side_entry',
    conversionManufacturer: 'BraunAbility', rampType: 'in_floor',
    wavFeatures: ['power_ramp', 'automatic_door'],
  }),
  row({
    // Null color — must be absent from the Color group rather than shown as a
    // bogus value.
    n: 4, make: 'Ford', model: 'Transit', year: 2019, trim: 'XL',
    condition: 'used', sellerType: 'dealer', priceCents: 2_800_000, mileage: 80_000,
    color: null, state: 'NY', conversionType: 'rear_entry',
    conversionManufacturer: null, rampType: 'fold_in',
    wavFeatures: ['tie_down_system'],
  }),
  row({
    // Unknown entry + unknown ramp + null price: counted in the total but
    // hidden from the Entry type and Features groups, and excluded by any
    // priceMax filter ("+1 without price listed" on the price histogram).
    n: 5, make: 'Honda', model: 'Odyssey', year: 2020, trim: 'EX',
    condition: 'used', sellerType: 'private', priceCents: null, mileage: 70_000,
    color: 'Silver', state: 'FL', conversionType: 'unknown',
    conversionManufacturer: null, rampType: 'unknown',
    wavFeatures: [],
  }),
  row({
    n: 6, make: 'Dodge', model: 'Grand Caravan', year: 2018, trim: 'SE',
    condition: 'used', sellerType: 'dealer', priceCents: 1_950_000, mileage: 95_000,
    color: 'Black', state: 'OH', conversionType: 'rear_entry',
    conversionManufacturer: null, rampType: 'fold_out',
    wavFeatures: ['has_lift', 'hand_controls'],
  }),
  row({
    // rampType 'none' must be hidden from the Features group; price and
    // mileage sit exactly on $5,000 / 25,000-mile bucket lower bounds.
    n: 7, make: 'Ram', model: 'ProMaster', year: 2023, trim: 'Cargo',
    condition: 'used', sellerType: 'dealer', priceCents: 5_000_000, mileage: 25_000,
    color: 'Gray', state: 'AZ', conversionType: 'rear_entry',
    conversionManufacturer: null, rampType: 'none',
    wavFeatures: [],
  }),
]

// ── Hand-derived expected manifest (7 catalog rows + 1 smoke listing) ──────
//
// Keys are the exact UI labels each renderer produces (filters/types.ts
// formatFilterLabel for slugs; curated names for conversion brands).

export const FACETS_EXPECTED = {
  total: 8,
  make: { Toyota: 2, Chrysler: 2, Ford: 1, Honda: 1, Dodge: 1, Ram: 1 },
  model: { Sienna: 2, Pacifica: 2, Transit: 1, Odyssey: 1, 'Grand Caravan': 1, ProMaster: 1 },
  trim: { XLE: 1, Touring: 1, Limited: 1, LE: 1, XL: 1, EX: 1, SE: 1, Cargo: 1 },
  condition: { Used: 7, New: 1 },
  sellerType: { Dealer: 6, Private: 2 },
  entryType: { 'Side Entry': 3, 'Rear Entry': 4 }, // 1 unknown row hidden from the group
  conversionBrand: { BraunAbility: 2, VMI: 2 }, // 4 rows carry no curated brand
  color: { Silver: 2, Blue: 1, Red: 1, White: 1, Black: 1, Gray: 1 }, // 1 null-color row absent
  state: { TX: 2, CA: 1, CO: 1, NY: 1, FL: 1, OH: 1, AZ: 1 },
  // Features = wavFeatures has_lift / hand_controls plus ramp types, with
  // 'unknown' and 'none' ramp rows hidden from the group.
  features: { 'Has lift': 1, 'Hand controls': 2, 'Fold Out': 3, 'In Floor': 2, 'Fold In': 1 },
} as const

// ── Seed / cleanup ─────────────────────────────────────────────────────────

async function withDb(fn: (db: PrismaClient) => Promise<void>): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl(), max: 1 })
  const adapter = new PrismaPg(pool)
  const db = new PrismaClient({ adapter })
  try {
    await fn(db)
  } finally {
    await db.$disconnect()
    await pool.end()
  }
}

/**
 * Indexing rides the production path: every Prisma write here advances
 * `updatedAt`, and the scraper's every-minute LISTING_INDEX_POLL checkpoint
 * poller (apps/scraper/src/jobs/search-indexer-poll.ts) syncs the touched
 * rows into Meilisearch. POST /admin/sync is deliberately NOT used — it
 * enqueues under a fixed BullMQ jobId that dedupes against the retained
 * completed rebuild from global-setup, so a second trigger in the same stack
 * silently no-ops. The poll cadence is one minute, hence the generous wait.
 */
const INDEX_WAIT_MS = 150_000

export async function seedFacetsCatalog(): Promise<void> {
  await withDb(async (db) => {
    await db.source.upsert({
      where: { id: sourceId },
      create: {
        id: sourceId,
        name: 'E2E Facets Source',
        baseUrl: 'https://example.com',
        status: 'active',
        cronExpression: '0 0 1 1 *',
        timezone: 'America/Denver',
      },
      update: {},
    })

    for (const brand of CONVERSION_BRANDS) {
      await db.conversionBrand.upsert({
        where: { slug: brand.slug },
        create: brand,
        update: {},
      })
    }

    for (const listing of CATALOG) {
      await db.listing.upsert({
        where: { id: listing.id as string },
        create: listing,
        update: listing,
      })
    }
  })

  await waitForSearchTotal(FACETS_EXPECTED.total)
  await waitForFacetsTotal(FACETS_EXPECTED.total)
}

export async function removeFacetsCatalog(): Promise<void> {
  // The search projection poller assumes no hard deletes (see
  // docs/architecture/decisions/0001-search-projection-mechanism.md), so
  // retire the rows the way production does: transition them to 'gone' and
  // let the incremental indexer drop them from the index.
  await withDb(async (db) => {
    await db.listing.updateMany({
      where: { id: { startsWith: facetsListingIdPrefix } },
      data: { status: 'gone', goneAt: new Date() },
    })
  })

  // Back to exactly the global-setup smoke listing.
  await waitForSearchTotal(1)

  // Now that the index no longer references them, the rows themselves can go
  // too, leaving the database as global-setup created it.
  await withDb(async (db) => {
    await db.listing.deleteMany({ where: { id: { startsWith: facetsListingIdPrefix } } })
    await db.conversionBrand.deleteMany({
      where: { slug: { in: CONVERSION_BRANDS.map((b) => b.slug) } },
    })
    await db.source.deleteMany({ where: { id: sourceId } })
  })
}

/** Deterministic readiness signal: the unfiltered listings total matches
 * what the database now holds. */
async function waitForSearchTotal(expectedTotal: number): Promise<void> {
  await poll(
    async () => {
      const res = await fetch(`${apiBaseUrl()}/v1/listings`)
      if (!res.ok) return false
      const body = (await res.json()) as { pagination?: { total?: number } }
      return body.pagination?.total === expectedTotal
    },
    `search index to report ${expectedTotal} listings`,
    INDEX_WAIT_MS,
  )
}

/** The facets endpoint has its own 60-second cache. Global setup and the
 * accessibility suite can populate that cache before this catalog is seeded,
 * so search readiness alone does not guarantee the browser will receive the
 * fixture-backed facet snapshot. */
async function waitForFacetsTotal(expectedTotal: number): Promise<void> {
  await poll(
    async () => {
      const res = await fetch(`${apiBaseUrl()}/v1/listings/facets`)
      if (!res.ok) return false
      const body = (await res.json()) as { data?: { total?: number } }
      return body.data?.total === expectedTotal
    },
    `facets API to report ${expectedTotal} listings`,
    INDEX_WAIT_MS,
  )
}
