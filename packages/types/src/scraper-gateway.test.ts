import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { FieldMapping } from './source.js'
import type {
  ConversionType,
  ConversionStatus,
  FieldResolutionState,
  ListingCondition,
  ListingDealer,
  ListingLocation,
  ListingSellerType,
  RampType,
  SaleStatus,
  WavFeature,
  WavFeatures,
  WavFieldResolution,
} from './listing.js'
import type { AssertTrue, MutuallyAssignable } from './type-parity.js'
import { issuePaths } from './test-helpers/issue-paths.js'
import type {
  conversionStatusSchema,
  conversionTypeSchema,
  fieldMappingSchema,
  fieldResolutionStateSchema,
  listingConditionSchema,
  listingDealerSchema,
  listingLocationSchema,
  listingSellerTypeSchema,
  rampTypeSchema,
  saleStatusSchema,
  wavFeatureSchema,
  wavFeaturesSchema,
  wavFieldResolutionSchema,
} from './scraper-gateway.js'
import {
  detailExtractSubmitRequestSchema,
  detailExtractSubmitResponseSchema,
  detailResultSchema,
  listingMarkGoneRequestSchema,
  listingUpsertRequestSchema,
  listingUpsertResponseSchema,
  scraperRunCompleteRequestSchema,
  sourceLastFullCrawlAtResponseSchema,
  sourceMarkActiveRequestSchema,
} from './scraper-gateway.js'

// --- compile-time parity with the hand-written types in ./listing.js ---
// (fails `tsc` if a schema's vocabulary or shape drifts from the interface)

export type _ConversionTypeParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof conversionTypeSchema>, ConversionType>
>
export type _RampTypeParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof rampTypeSchema>, RampType>
>
export type _ConversionStatusParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof conversionStatusSchema>, ConversionStatus>
>
export type _ListingConditionParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof listingConditionSchema>, ListingCondition>
>
export type _ListingSellerTypeParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof listingSellerTypeSchema>, ListingSellerType>
>
export type _SaleStatusParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof saleStatusSchema>, SaleStatus>
>
export type _FieldResolutionStateParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof fieldResolutionStateSchema>, FieldResolutionState>
>
export type _WavFeatureParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof wavFeatureSchema>, WavFeature>
>
export type _WavFeaturesParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof wavFeaturesSchema>, WavFeatures>
>
export type _WavFieldResolutionParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof wavFieldResolutionSchema>, WavFieldResolution>
>
export type _ListingLocationParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof listingLocationSchema>, ListingLocation>
>
export type _ListingDealerParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof listingDealerSchema>, ListingDealer>
>
export type _FieldMappingParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof fieldMappingSchema>, FieldMapping>
>

// --- runtime fixtures ---

const validUpsert = {
  sourceId: 'src-1',
  sourceUrl: 'https://dealer.example/listing/1',
  buyerUrl: null,
  externalId: 'ext-1',
  stockNumber: null,
  sourceRecordKey: 'rec-1',
  make: 'Toyota',
  model: 'Sienna',
  year: 2022,
  trim: 'LE',
  vin: null,
  condition: 'used',
  sellerType: 'dealer',
  priceCents: 4599900,
  mileage: 32000,
  color: 'Silver',
  fuelType: 'Gasoline',
  transmission: 'Automatic',
  wav: {
    conversionType: 'side_entry',
    conversionManufacturer: 'BraunAbility',
    floorLoweringInches: 10,
    rampType: 'in_floor',
    conversionStatus: 'complete',
    wavFeatures: ['power_ramp', 'kneel_system'],
    wheelchairCapacity: 1,
  },
  location: { zip: '30301', city: 'Atlanta', state: 'GA', lat: null, lng: null },
  dealer: { name: 'Example Mobility', phone: null, website: null },
  images: ['https://dealer.example/img/1.jpg'],
  description: 'Clean one-owner WAV.',
  saleStatus: 'active',
  soldAt: null,
  listedAt: '2026-08-01T00:00:00.000Z',
  sourceListedAt: '2026-07-30T00:00:00.000Z',
  runId: 'run-1',
}

describe('listingUpsertRequestSchema', () => {
  it('should coerce ISO date strings to Dates', () => {
    const parsed = listingUpsertRequestSchema.parse(validUpsert)
    expect(parsed.listedAt).toEqual(new Date('2026-08-01T00:00:00.000Z'))
  })

  it('should preserve null date fields', () => {
    expect(listingUpsertRequestSchema.parse(validUpsert).soldAt).toBeNull()
  })

  it('should parse the nested wav feature vocabulary', () => {
    expect(listingUpsertRequestSchema.parse(validUpsert).wav.wavFeatures).toEqual([
      'power_ramp',
      'kneel_system',
    ])
  })

  it('should reject a missing sourceRecordKey with a field-level path', () => {
    const rest: Record<string, unknown> = { ...validUpsert }
    delete rest['sourceRecordKey']
    expect(issuePaths(listingUpsertRequestSchema.safeParse(rest))).toContain('sourceRecordKey')
  })

  it('should reject a mistyped year', () => {
    const result = listingUpsertRequestSchema.safeParse({ ...validUpsert, year: '2022' })
    expect(issuePaths(result)).toContain('year')
  })

  it('should reject an unknown wav feature with a nested path', () => {
    const result = listingUpsertRequestSchema.safeParse({
      ...validUpsert,
      wav: { ...validUpsert.wav, wavFeatures: ['jetpack'] },
    })
    expect(issuePaths(result)).toContain('wav.wavFeatures.0')
  })

  it('should reject an unparseable listedAt', () => {
    const result = listingUpsertRequestSchema.safeParse({ ...validUpsert, listedAt: 'yesterday' })
    expect(issuePaths(result)).toContain('listedAt')
  })

  it('should reject a numeric listedAt (no epoch-millisecond coercion)', () => {
    const result = listingUpsertRequestSchema.safeParse({ ...validUpsert, listedAt: 2022 })
    expect(issuePaths(result)).toContain('listedAt')
  })
})

describe('listingUpsertResponseSchema', () => {
  it('should parse each outcome', () => {
    for (const outcome of ['created', 'updated', 'unchanged'] as const) {
      expect(
        listingUpsertResponseSchema.parse({ listingId: 'l-1', outcome, changedFields: [] }).outcome,
      ).toBe(outcome)
    }
  })

  it('should reject an unknown outcome', () => {
    const result = listingUpsertResponseSchema.safeParse({
      listingId: 'l-1',
      outcome: 'skipped',
      changedFields: [],
    })
    expect(issuePaths(result)).toContain('outcome')
  })
})

describe('listingMarkGoneRequestSchema', () => {
  it('should require the scraperRunId idempotency key', () => {
    const result = listingMarkGoneRequestSchema.safeParse({
      sourceId: 'src-1',
      activeSourceRecordKeys: ['a', 'b'],
      isCompleteCrawl: true,
    })
    expect(issuePaths(result)).toContain('scraperRunId')
  })

  it('should parse a valid request', () => {
    const request = {
      sourceId: 'src-1',
      scraperRunId: 'run-1',
      activeSourceRecordKeys: [],
      isCompleteCrawl: false,
    }
    expect(listingMarkGoneRequestSchema.parse(request)).toEqual(request)
  })
})

describe('scraper-run and source contracts', () => {
  it('should parse a run completion without change counts', () => {
    expect(
      scraperRunCompleteRequestSchema.parse({ runId: 'r-1', listingsFound: 12 }).changes,
    ).toBeUndefined()
  })

  it('should parse a run completion with change counts', () => {
    expect(
      scraperRunCompleteRequestSchema.parse({
        runId: 'r-1',
        listingsFound: 12,
        changes: { listingsNew: 3, listingsUpdated: 4 },
      }).changes,
    ).toEqual({ listingsNew: 3, listingsUpdated: 4 })
  })

  it('should reject a negative listing count on mark-active', () => {
    const result = sourceMarkActiveRequestSchema.safeParse({
      sourceId: 'src-1',
      listingCount: -1,
      fingerprintHash: 'abc',
      isCompleteCrawl: true,
    })
    expect(issuePaths(result)).toContain('listingCount')
  })

  it('should parse a null lastFullCrawlAt', () => {
    expect(
      sourceLastFullCrawlAtResponseSchema.parse({ lastFullCrawlAt: null }).lastFullCrawlAt,
    ).toBeNull()
  })

  it('should parse an ISO lastFullCrawlAt into a Date', () => {
    expect(
      sourceLastFullCrawlAtResponseSchema.parse({
        lastFullCrawlAt: '2026-08-01T00:00:00.000Z',
      }).lastFullCrawlAt,
    ).toEqual(new Date('2026-08-01T00:00:00.000Z'))
  })
})

const validDetail = {
  color: 'Silver',
  fuelType: null,
  engine: '3.5L V6',
  transmission: 'Automatic',
  rampType: 'in_floor',
  conversionType: 'side_entry',
  wavFeatures: ['power_ramp'],
  floorLoweringInches: 10,
  wheelchairCapacity: 1,
  description: 'Side-entry conversion.',
  images: ['https://dealer.example/img/1.jpg'],
  zip: '30301',
  dealerPhone: null,
  saleStatus: 'active',
  sourceListedAt: null,
  sourceUpdatedAt: '2026-08-05T00:00:00.000Z',
  evidence: {
    color: 'value',
    fuelType: 'missing',
    engine: 'value',
    transmission: 'value',
    description: 'value',
    images: 'value',
    accessibilityClaims: 'value',
  },
}

describe('detailExtractSubmitRequestSchema', () => {
  it('should parse a submission with a matched listing', () => {
    const parsed = detailExtractSubmitRequestSchema.parse({
      sourceId: 'src-1',
      rawPageId: 'raw-1',
      listingId: 'l-1',
      detail: validDetail,
      enrichment: { dealerWebsite: null, directVehicleUrl: null },
    })
    expect(parsed.detail.sourceUpdatedAt).toEqual(new Date('2026-08-05T00:00:00.000Z'))
  })

  it('should parse a submission with no matched listing', () => {
    const parsed = detailExtractSubmitRequestSchema.parse({
      sourceId: 'src-1',
      rawPageId: 'raw-1',
      listingId: null,
      detail: validDetail,
      enrichment: { dealerWebsite: null, directVehicleUrl: null },
    })
    expect(parsed.listingId).toBeNull()
  })

  it('should reject a mistyped evidence value with a nested path', () => {
    const result = detailExtractSubmitRequestSchema.safeParse({
      sourceId: 'src-1',
      rawPageId: 'raw-1',
      listingId: 'l-1',
      detail: { ...validDetail, evidence: { ...validDetail.evidence, images: 'yes' } },
      enrichment: { dealerWebsite: null, directVehicleUrl: null },
    })
    expect(issuePaths(result)).toContain('detail.evidence.images')
  })

  it('should reject a detail missing its evidence block', () => {
    const detailWithoutEvidence: Record<string, unknown> = { ...validDetail }
    delete detailWithoutEvidence['evidence']
    expect(issuePaths(detailResultSchema.safeParse(detailWithoutEvidence))).toContain('evidence')
  })
})

describe('detailExtractSubmitResponseSchema', () => {
  it('should parse each outcome', () => {
    for (const outcome of ['applied', 'already_applied', 'listing_not_found'] as const) {
      expect(detailExtractSubmitResponseSchema.parse({ outcome, changedFields: [] }).outcome).toBe(
        outcome,
      )
    }
  })
})
