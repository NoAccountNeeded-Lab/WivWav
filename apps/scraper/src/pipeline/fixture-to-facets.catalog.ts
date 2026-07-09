/**
 * Checked-in controlled catalog for the fixture-to-facets pipeline contract
 * suite (#640). Every row is either derived from a checked-in offline source
 * fixture (apps/scraper/src/sources/fixtures/contracts/, added for #639) via
 * the real DOM-parsing production code, or hand-authored directly as the
 * already-parsed `ListingUpsertData` shape the ingestion pipeline persists.
 *
 * Hand-authored rows exist to give the search/facets layer the value
 * diversity (states, colors, price/mileage bucket boundaries, conversion
 * brand aliases, duplicate VINs, pending/quarantined/gone lifecycles) the two
 * DOM-fixture rows alone cannot provide — the DOM-extraction contract itself
 * (list card → parsed listing, detail page → parsed detail) is already
 * exhaustively covered by fixture-contract.test.ts (#639); this suite's job
 * is the *next* stage: parsed observation → database row → publication
 * decision → search document → facet API → filtered listing API.
 *
 * IMPORTANT: expected values below are hand-derived by manually tracing each
 * row through packages/search/src/canonicalize.ts's alias tables (verified
 * once, offline, against the real functions during authoring — see the AC's
 * "do not derive the expected manifest using the same production aggregation
 * code being tested"). Do not import canonicalize.ts here to "simplify" this
 * file — that would silently defeat the contract this suite exists to prove.
 */
import type { Listing } from '@wivwav/types'

/**
 * Matches apps/scraper/src/engine/repositories.ts's ListingUpsertData exactly
 * (re-declared here rather than imported so this catalog has zero dependency
 * on scraper internals beyond the shared @wivwav/types Listing shape).
 */
export type ListingUpsertData = Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> & {
  publicationStatus?: 'pending' | 'eligible' | 'quarantined'
  qualityCheckedAt?: Date | null
}

export type RowLifecycle = 'eligible' | 'quarantined' | 'pending' | 'gone'

export interface CatalogRow {
  id: string
  lifecycle: RowLifecycle
  upsert: ListingUpsertData
}

export interface CatalogSourceIds {
  blvdSourceId: string
  mwSourceId: string
  pendingSourceId: string
}

const LISTED_AT = new Date('2026-01-01T00:00:00.000Z')

function base(overrides: Partial<ListingUpsertData> & Pick<ListingUpsertData, 'sourceId' | 'sourceUrl' | 'sourceRecordKey' | 'make' | 'model' | 'year' | 'condition' | 'sellerType'>): ListingUpsertData {
  return {
    buyerUrl: null,
    externalId: null,
    stockNumber: null,
    trim: null,
    vin: null,
    priceCents: null,
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
    location: { zip: null, city: null, state: null, lat: null, lng: null },
    dealer: { name: 'Catalog Test Dealer', phone: null, website: null },
    images: [],
    description: null,
    qualityIssueCodes: [],
    saleStatus: 'active',
    soldAt: null,
    listedAt: LISTED_AT,
    ...overrides,
  }
}

/**
 * Hand-authored catalog rows. Rows `blvd-fixture` and `mobilityworks-fixture`
 * are NOT here — they are built at runtime in the test file by driving the
 * real checked-in HTML fixtures through the real DOM-parsing + detail-update
 * production code (see buildFixtureDerivedRows in the test file).
 */
export function buildHandAuthoredRows(ids: CatalogSourceIds): CatalogRow[] {
  const { blvdSourceId, mwSourceId, pendingSourceId } = ids

  return [
    {
      id: 'private-no-optional-fields',
      lifecycle: 'eligible',
      upsert: base({
        sourceId: blvdSourceId,
        sourceUrl: 'https://fixture.example.com/blvd/catalog-2',
        sourceRecordKey: 'CATALOG-BLVD-2',
        make: 'Chrysler',
        model: 'Pacifica',
        trim: 'Touring L',
        year: 2020,
        condition: 'used',
        sellerType: 'private',
        // priceCents/mileage/color/state intentionally absent — optional-field absence coverage.
      }),
    },
    {
      id: 'duplicate-a-blvd',
      lifecycle: 'eligible',
      upsert: base({
        sourceId: blvdSourceId,
        sourceUrl: 'https://fixture.example.com/blvd/catalog-3',
        sourceRecordKey: 'CATALOG-BLVD-3',
        make: 'Ford',
        model: 'Transit',
        trim: 'XL',
        year: 2019,
        condition: 'used',
        sellerType: 'dealer',
        vin: '1FTFW1XT0EFA12345',
        priceCents: 2_800_000,
        mileage: 80_000,
        wav: {
          conversionType: 'rear_entry',
          conversionManufacturer: null,
          floorLoweringInches: null,
          rampType: 'fold_out',
          conversionStatus: 'unknown',
          wavFeatures: ['tie_down_system'],
          wheelchairCapacity: null,
        },
        location: { zip: null, city: null, state: 'TX', lat: null, lng: null },
      }),
    },
    {
      // Same VIN as duplicate-a-blvd, cross-source, more complete — must win
      // representative selection (packages/search selectRepresentative).
      id: 'duplicate-b-mobilityworks',
      lifecycle: 'eligible',
      upsert: base({
        sourceId: mwSourceId,
        sourceUrl: 'https://fixture.example.com/mw/catalog-2',
        sourceRecordKey: 'CATALOG-MW-2',
        make: 'Ford',
        model: 'Transit',
        trim: 'XL',
        year: 2019,
        condition: 'used',
        sellerType: 'dealer',
        vin: '1FTFW1XT0EFA12345',
        priceCents: 2_850_000,
        mileage: 79_500,
        color: 'Silver',
        wav: {
          conversionType: 'rear_entry',
          conversionManufacturer: 'Braun',
          floorLoweringInches: null,
          rampType: 'fold_out',
          conversionStatus: 'unknown',
          wavFeatures: ['tie_down_system', 'automatic_door'],
          wheelchairCapacity: null,
        },
        location: { zip: null, city: null, state: 'TX', lat: null, lng: null },
      }),
    },
    {
      // implausible_year is an 'error'-severity issue -> decidePublication quarantines.
      id: 'quarantined-bad-year',
      lifecycle: 'quarantined',
      upsert: base({
        sourceId: blvdSourceId,
        sourceUrl: 'https://fixture.example.com/blvd/catalog-4',
        sourceRecordKey: 'CATALOG-BLVD-4',
        make: 'Dodge',
        model: 'Grand Caravan',
        trim: 'SXT',
        year: 1800,
        condition: 'used',
        sellerType: 'dealer',
        priceCents: 1_500_000,
        mileage: 120_000,
        wav: {
          conversionType: 'rear_entry',
          conversionManufacturer: null,
          floorLoweringInches: null,
          rampType: 'fold_out',
          conversionStatus: 'unknown',
          wavFeatures: [],
          wheelchairCapacity: null,
        },
        location: { zip: null, city: null, state: 'NY', lat: null, lng: null },
      }),
    },
    {
      // Ingested through the same production repository path but its source
      // is deliberately never drained by runListingResolveJob — models the
      // real operational window between a card recrawl and resolution.
      id: 'pending-never-resolved',
      lifecycle: 'pending',
      upsert: base({
        sourceId: pendingSourceId,
        sourceUrl: 'https://fixture.example.com/pending/catalog-1',
        sourceRecordKey: 'CATALOG-PENDING-1',
        make: 'Toyota',
        model: 'Sienna',
        trim: 'LE',
        year: 2018,
        condition: 'used',
        sellerType: 'dealer',
        priceCents: 2_600_000,
        mileage: 95_000,
        wav: {
          conversionType: 'side_entry',
          conversionManufacturer: null,
          floorLoweringInches: null,
          rampType: 'in_floor',
          conversionStatus: 'unknown',
          wavFeatures: [],
          wheelchairCapacity: null,
        },
        location: { zip: null, city: null, state: 'FL', lat: null, lng: null },
      }),
    },
    {
      // Resolved eligible, then explicitly transitioned to 'gone' post-resolve
      // (see markGone in the test file) — must disappear from search/facets.
      id: 'gone-after-eligible',
      lifecycle: 'gone',
      upsert: base({
        sourceId: mwSourceId,
        sourceUrl: 'https://fixture.example.com/mw/catalog-3',
        sourceRecordKey: 'CATALOG-MW-3',
        make: 'Honda',
        model: 'Odyssey',
        trim: 'Touring',
        year: 2020,
        condition: 'used',
        sellerType: 'dealer',
        priceCents: 3_200_000,
        mileage: 60_000,
        wav: {
          conversionType: 'side_entry',
          conversionManufacturer: null,
          floorLoweringInches: null,
          rampType: 'in_floor',
          conversionStatus: 'unknown',
          wavFeatures: [],
          wheelchairCapacity: null,
        },
        location: { zip: null, city: null, state: 'NV', lat: null, lng: null },
      }),
    },
    {
      // Price/mileage bucket boundary collisions with other rows (see the
      // expected-manifest comments below) + a fourth distinct rampType value.
      id: 'bucket-boundaries',
      lifecycle: 'eligible',
      upsert: base({
        sourceId: blvdSourceId,
        sourceUrl: 'https://fixture.example.com/blvd/catalog-5',
        sourceRecordKey: 'CATALOG-BLVD-5',
        make: 'Ram',
        model: 'ProMaster',
        trim: 'Cargo',
        year: 2023,
        condition: 'used',
        sellerType: 'dealer',
        priceCents: 5_000_000, // exact $50,000 bucket boundary
        mileage: 25_000, // exact 25,000-mile bucket boundary
        color: 'Guard', // alias -> Green
        wav: {
          conversionType: 'rear_entry',
          conversionManufacturer: 'Freedom Motors',
          floorLoweringInches: null,
          rampType: 'fold_in',
          conversionStatus: 'unknown',
          wavFeatures: ['automatic_door'],
          wheelchairCapacity: null,
        },
        location: { zip: null, city: null, state: 'AZ', lat: null, lng: null },
      }),
    },
    {
      // Conversion-brand alias coverage: raw "ams" -> conversionBrand "ams-vans".
      id: 'conversion-brand-alias',
      lifecycle: 'eligible',
      upsert: base({
        sourceId: mwSourceId,
        sourceUrl: 'https://fixture.example.com/mw/catalog-4',
        sourceRecordKey: 'CATALOG-MW-4',
        make: 'Chrysler',
        model: 'Pacifica',
        trim: 'Limited',
        year: 2021,
        condition: 'used',
        sellerType: 'dealer',
        priceCents: 4_100_000,
        mileage: 45_000,
        color: 'Rapid Red', // alias -> Red
        wav: {
          conversionType: 'rear_entry',
          conversionManufacturer: 'ams',
          floorLoweringInches: null,
          rampType: 'in_floor',
          conversionStatus: 'unknown',
          wavFeatures: ['hand_controls', 'motorized_running_board'],
          wheelchairCapacity: null,
        },
        location: { zip: null, city: null, state: 'OH', lat: null, lng: null },
      }),
    },
    {
      // Fifth rampType value ('none') + fifth distinct make/model combo.
      id: 'extra-diversity',
      lifecycle: 'eligible',
      upsert: base({
        sourceId: blvdSourceId,
        sourceUrl: 'https://fixture.example.com/blvd/catalog-6',
        sourceRecordKey: 'CATALOG-BLVD-6',
        make: 'Toyota',
        model: 'Sienna',
        trim: 'Limited',
        year: 2023,
        condition: 'new',
        sellerType: 'dealer',
        priceCents: 6_000_000,
        mileage: 10,
        color: 'Ingot Silver', // alias -> Silver
        wav: {
          conversionType: 'side_entry',
          conversionManufacturer: 'Rollx Vans',
          floorLoweringInches: null,
          rampType: 'none',
          conversionStatus: 'unknown',
          wavFeatures: ['transfer_seat'],
          wheelchairCapacity: null,
        },
        location: { zip: null, city: null, state: 'CA', lat: null, lng: null },
      }),
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────────
// Hand-authored expected facet manifest.
//
// Traced by hand from the 9 rows above plus the two DOM-fixture rows
// (blvd-normal / mobilityworks-normal from apps/scraper/src/sources/fixtures/
// contracts/expected.json) through canonicalize.ts's alias tables. The 3
// excluded rows (quarantined-bad-year, pending-never-resolved,
// gone-after-eligible) never appear below by design.
//
// Eligible unique vehicle groups = 7 (duplicate-a/duplicate-b collapse to
// one representative — duplicate-b-mobilityworks wins on completeness).
// ─────────────────────────────────────────────────────────────────────────

export const EXPECTED_TOTAL = 7

export const EXPECTED_BREAKDOWNS = {
  make: { Toyota: 3, Ford: 1, Chrysler: 2, Ram: 1 },
  model: { Sienna: 3, Transit: 1, Pacifica: 2, ProMaster: 1 },
  trim: { XLE: 2, 'Touring L': 1, XL: 1, Cargo: 1, Limited: 2 },
  year: { 2019: 1, 2020: 1, 2021: 1, 2022: 2, 2023: 2 },
  condition: { used: 6, new: 1 },
  sellerType: { dealer: 6, private: 1 },
  state: { CO: 1, GA: 1, TX: 1, AZ: 1, OH: 1, CA: 1 }, // 1 row (private) has null state, absent here
  color: { 'Celestial silver': 1, Blueprint: 1, Silver: 2, Green: 1, Red: 1 }, // 1 row has null color
  conversionType: { rear_entry: 4, side_entry: 2, unknown: 1 },
  rampType: { fold_out: 2, in_floor: 2, unknown: 1, fold_in: 1, none: 1 },
  conversionBrand: { driverge: 1, braunability: 2, 'freedom-motors': 1, 'ams-vans': 1, 'rollx-vans': 1 }, // 1 row has null brand
} as const

/** Multi-valued — deliberately not asserted to sum to EXPECTED_TOTAL (a listing may carry 0..N features). */
export const EXPECTED_WAV_FEATURE_COUNTS: Record<string, number> = {
  transfer_seat: 3,
  lowered_floor: 2,
  power_ramp: 2,
  kneel_system: 2,
  tie_down_system: 3,
  automatic_door: 4,
  hand_controls: 2,
  motorized_running_board: 1,
  // has_lift deliberately absent — zero listings carry it, and Meilisearch
  // omits zero-count facet values entirely rather than reporting a 0.
}

export const EXPECTED_PRICE_BUCKETS: Record<string, number> = {
  '25000-30000': 1, // duplicate-b-mobilityworks representative ($28,500)
  '40000-45000': 1, // conversion-brand-alias ($41,000)
  '50000-55000': 1, // bucket-boundaries, exact $50,000 lower-bound boundary
  '60000-65000': 1, // extra-diversity ($60,000)
  '65000-70000': 1, // mobilityworks-normal fixture ($68,250)
  '70000-75000': 1, // blvd-normal fixture ($71,991)
}

export const EXPECTED_MILEAGE_BUCKETS: Record<string, number> = {
  '0-25000': 2, // mobilityworks-normal fixture (14,200) + extra-diversity (10)
  '25000-50000': 2, // bucket-boundaries (exact 25,000 boundary) + conversion-brand-alias (45,000)
  '50000-75000': 1, // blvd-normal fixture (50,094)
  '75000-100000': 1, // duplicate-b-mobilityworks representative (79,500)
}

/**
 * For every supported facet value: the `GET /v1/listings` filter param/value
 * pair that must isolate it, and the exact total it must return. Values that
 * appear on more than one eligible row are included so the "for every
 * supported facet value" AC is not vacuously satisfied by singletons only.
 */
export const EXPECTED_FILTER_COUNTS: Array<{ param: string; value: string; total: number }> = [
  { param: 'make', value: 'Toyota', total: 3 },
  { param: 'make', value: 'Ford', total: 1 },
  { param: 'make', value: 'Chrysler', total: 2 },
  { param: 'make', value: 'Ram', total: 1 },
  { param: 'model', value: 'Sienna', total: 3 },
  { param: 'model', value: 'Transit', total: 1 },
  { param: 'trim', value: 'Limited', total: 2 },
  { param: 'trim', value: 'XLE', total: 2 },
  { param: 'condition', value: 'used', total: 6 },
  { param: 'condition', value: 'new', total: 1 },
  { param: 'sellerType', value: 'dealer', total: 6 },
  { param: 'sellerType', value: 'private', total: 1 },
  { param: 'state', value: 'CO', total: 1 },
  { param: 'state', value: 'TX', total: 1 },
  { param: 'color', value: 'Silver', total: 2 },
  { param: 'color', value: 'Celestial silver', total: 1 },
  { param: 'conversionType', value: 'rear_entry', total: 4 },
  { param: 'conversionType', value: 'side_entry', total: 2 },
  { param: 'conversionType', value: 'unknown', total: 1 },
  { param: 'rampType', value: 'fold_out', total: 2 },
  { param: 'rampType', value: 'in_floor', total: 2 },
  { param: 'rampType', value: 'fold_in', total: 1 },
  { param: 'rampType', value: 'none', total: 1 },
  { param: 'rampType', value: 'unknown', total: 1 },
  { param: 'conversionBrand', value: 'braunability', total: 2 },
  { param: 'conversionBrand', value: 'ams-vans', total: 1 },
  { param: 'conversionBrand', value: 'rollx-vans', total: 1 },
  { param: 'wavFeatures', value: 'automatic_door', total: 4 },
  { param: 'wavFeatures', value: 'transfer_seat', total: 3 },
]
