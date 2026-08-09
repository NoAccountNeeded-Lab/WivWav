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
  wavFieldResolutionSchema} from './scraper-gateway.js';
import {
  detailExtractSubmitRequestSchema,
  detailExtractSubmitResponseSchema,
  detailResultSchema,
  listingMarkGoneRequestSchema,
  listingUpsertRequestSchema,
  listingUpsertResponseSchema,
  scraperRunCompleteRequestSchema,
  sourceLastFullCrawlAtResponseSchema,
  sourceMarkActiveRequestSchema
} from './scraper-gateway.js'

// --- compile-time parity with the hand-written types in ./listing.js ---
// (fails `tsc` if a schema's vocabulary or shape drifts from the interface)

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

export type _ConversionTypeParity = Assert<
  MutuallyAssignable<z.infer<typeof conversionTypeSchema>, ConversionType>
>
export type _RampTypeParity = Assert<MutuallyAssignable<z.infer<typeof rampTypeSchema>, RampType>>
export type _ConversionStatusParity = Assert<
  MutuallyAssignable<z.infer<typeof conversionStatusSchema>, ConversionStatus>
>
export type _ListingConditionParity = Assert<
  MutuallyAssignable<z.infer<typeof listingConditionSchema>, ListingCondition>
>
export type _ListingSellerTypeParity = Assert<
  MutuallyAssignable<z.infer<typeof listingSellerTypeSchema>, ListingSellerType>
>
export type _SaleStatusParity = Assert<MutuallyAssignable<z.infer<typeof saleStatusSchema>, SaleStatus>>
export type _FieldResolutionStateParity = Assert<
  MutuallyAssignable<z.infer<typeof fieldResolutionStateSchema>, FieldResolutionState>
>
export type _WavFeatureParity = Assert<MutuallyAssignable<z.infer<typeof wavFeatureSchema>, WavFeature>>
export type _WavFeaturesParity = Assert<
  MutuallyAssignable<z.infer<typeof wavFeaturesSchema>, WavFeatures>
>
export type _WavFieldResolutionParity = Assert<
  MutuallyAssignable<z.infer<typeof wavFieldResolutionSchema>, WavFieldResolution>
>
export type _ListingLocationParity = Assert<
  MutuallyAssignable<z.infer<typeof listingLocationSchema>, ListingLocation>
>
export type _ListingDealerParity = Assert<
  MutuallyAssignable<z.infer<typeof listingDealerSchema>, ListingDealer>
>
export type _FieldMappingParity = Assert<
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
  it('parses a valid upsert and coerces ISO date strings to Dates', () => {
    const parsed = listingUpsertRequestSchema.parse(validUpsert)
    expect(parsed.listedAt).toBeInstanceOf(Date)
    expect(parsed.listedAt.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(parsed.sourceListedAt).toBeInstanceOf(Date)
    expect(parsed.soldAt).toBeNull()
    expect(parsed.wav.wavFeatures).toEqual(['power_ramp', 'kneel_system'])
  })

  it('rejects a missing sourceRecordKey with a field-level path', () => {
    const rest: Record<string, unknown> = { ...validUpsert }
    delete rest['sourceRecordKey']
    const result = listingUpsertRequestSchema.safeParse(rest)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('sourceRecordKey')
  })

  it('rejects a mistyped year', () => {
    const result = listingUpsertRequestSchema.safeParse({ ...validUpsert, year: '2022' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('year')
  })

  it('rejects an unknown wav feature with a nested path', () => {
    const result = listingUpsertRequestSchema.safeParse({
      ...validUpsert,
      wav: { ...validUpsert.wav, wavFeatures: ['jetpack'] },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(
      'wav.wavFeatures.0',
    )
  })

  it('rejects an unparseable listedAt', () => {
    const result = listingUpsertRequestSchema.safeParse({ ...validUpsert, listedAt: 'yesterday' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('listedAt')
  })
})

describe('listingUpsertResponseSchema', () => {
  it('parses each outcome', () => {
    for (const outcome of ['created', 'updated', 'unchanged'] as const) {
      expect(
        listingUpsertResponseSchema.parse({ listingId: 'l-1', outcome, changedFields: [] })
          .outcome,
      ).toBe(outcome)
    }
  })

  it('rejects an unknown outcome', () => {
    const result = listingUpsertResponseSchema.safeParse({
      listingId: 'l-1',
      outcome: 'skipped',
      changedFields: [],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('outcome')
  })
})

describe('listingMarkGoneRequestSchema', () => {
  it('requires the scraperRunId idempotency key', () => {
    const result = listingMarkGoneRequestSchema.safeParse({
      sourceId: 'src-1',
      activeSourceRecordKeys: ['a', 'b'],
      isCompleteCrawl: true,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('scraperRunId')
  })

  it('parses a valid request', () => {
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
  it('parses a run completion with and without change counts', () => {
    expect(
      scraperRunCompleteRequestSchema.parse({ runId: 'r-1', listingsFound: 12 }).changes,
    ).toBeUndefined()
    expect(
      scraperRunCompleteRequestSchema.parse({
        runId: 'r-1',
        listingsFound: 12,
        changes: { listingsNew: 3, listingsUpdated: 4 },
      }).changes,
    ).toEqual({ listingsNew: 3, listingsUpdated: 4 })
  })

  it('rejects a negative listing count on mark-active', () => {
    const result = sourceMarkActiveRequestSchema.safeParse({
      sourceId: 'src-1',
      listingCount: -1,
      fingerprintHash: 'abc',
      isCompleteCrawl: true,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('listingCount')
  })

  it('round-trips a nullable lastFullCrawlAt', () => {
    expect(
      sourceLastFullCrawlAtResponseSchema.parse({ lastFullCrawlAt: null }).lastFullCrawlAt,
    ).toBeNull()
    expect(
      sourceLastFullCrawlAtResponseSchema.parse({
        lastFullCrawlAt: '2026-08-01T00:00:00.000Z',
      }).lastFullCrawlAt,
    ).toBeInstanceOf(Date)
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
  it('parses a submission with a matched listing', () => {
    const parsed = detailExtractSubmitRequestSchema.parse({
      sourceId: 'src-1',
      rawPageId: 'raw-1',
      listingId: 'l-1',
      detail: validDetail,
      enrichment: { dealerWebsite: null, directVehicleUrl: null },
    })
    expect(parsed.detail.sourceUpdatedAt).toBeInstanceOf(Date)
    expect(parsed.listingId).toBe('l-1')
  })

  it('parses a submission with no matched listing', () => {
    const parsed = detailExtractSubmitRequestSchema.parse({
      sourceId: 'src-1',
      rawPageId: 'raw-1',
      listingId: null,
      detail: validDetail,
      enrichment: { dealerWebsite: null, directVehicleUrl: null },
    })
    expect(parsed.listingId).toBeNull()
  })

  it('rejects a mistyped evidence value with a nested path', () => {
    const result = detailExtractSubmitRequestSchema.safeParse({
      sourceId: 'src-1',
      rawPageId: 'raw-1',
      listingId: 'l-1',
      detail: { ...validDetail, evidence: { ...validDetail.evidence, images: 'yes' } },
      enrichment: { dealerWebsite: null, directVehicleUrl: null },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(
      'detail.evidence.images',
    )
  })

  it('rejects a detail missing its evidence block', () => {
    const detailWithoutEvidence: Record<string, unknown> = { ...validDetail }
    delete detailWithoutEvidence['evidence']
    const result = detailResultSchema.safeParse(detailWithoutEvidence)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('evidence')
  })
})

describe('detailExtractSubmitResponseSchema', () => {
  it('parses each outcome', () => {
    for (const outcome of ['applied', 'already_applied', 'listing_not_found'] as const) {
      expect(
        detailExtractSubmitResponseSchema.parse({ outcome, changedFields: [] }).outcome,
      ).toBe(outcome)
    }
  })
})
