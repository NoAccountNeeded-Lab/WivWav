import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type {
  blvdDealerEnrichmentSchema,
  detailResultSchema,
  listingUpsertResponseSchema,
  sourceDriftBaselineSchema,
  sourceExecutionStateSchema} from '@wivwav/types';
import {
  listingUpsertRequestSchema
} from '@wivwav/types'
import type {
  ListingUpsertData,
  ListingUpsertResult,
  SourceExecutionState,
} from './repositories.js'
import type { SourceDriftBaseline } from './listing-validator.js'
import type { DetailResult } from '../jobs/detail-extract.js'
import type { BlvdDealerEnrichment } from '../sources/blvd-dealer-enrichment.js'

/**
 * Compile-time parity between the wire contracts in @wivwav/types and the
 * hand-written shapes they mirror (#948/#949). If a field is added, removed,
 * or retyped on either side, `tsc` fails here.
 *
 * `WidenOptional` adds `| undefined` to every property before comparing:
 * under `exactOptionalPropertyTypes`, zod's `.optional()` infers `?: T |
 * undefined` while the hand-written types write `?: T` — a difference with
 * no wire-level meaning. Required keys stay load-bearing: a wrongly optional
 * or missing key still fails both directions.
 */
type WidenOptional<T> = { [K in keyof T]: T[K] | undefined }
type MutuallyAssignable<A, B> = [A] extends [WidenOptional<B>]
  ? [B] extends [WidenOptional<A>]
    ? true
    : false
  : false
type Assert<T extends true> = T

export type _ListingUpsertRequestParity = Assert<
  MutuallyAssignable<z.infer<typeof listingUpsertRequestSchema>, ListingUpsertData>
>
export type _ListingUpsertResponseParity = Assert<
  MutuallyAssignable<z.infer<typeof listingUpsertResponseSchema>, ListingUpsertResult>
>
export type _SourceExecutionStateParity = Assert<
  MutuallyAssignable<z.infer<typeof sourceExecutionStateSchema>, SourceExecutionState>
>
export type _SourceDriftBaselineParity = Assert<
  MutuallyAssignable<z.infer<typeof sourceDriftBaselineSchema>, SourceDriftBaseline>
>
export type _DetailResultParity = Assert<
  MutuallyAssignable<z.infer<typeof detailResultSchema>, DetailResult>
>
export type _BlvdDealerEnrichmentParity = Assert<
  MutuallyAssignable<z.infer<typeof blvdDealerEnrichmentSchema>, BlvdDealerEnrichment>
>

describe('gateway contract parity', () => {
  it('a schema-parsed upsert payload is a valid ListingUpsertData', () => {
    const parsed = listingUpsertRequestSchema.parse({
      sourceId: 'src-1',
      sourceUrl: 'https://dealer.example/listing/1',
      buyerUrl: null,
      externalId: null,
      stockNumber: null,
      sourceRecordKey: 'rec-1',
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      trim: null,
      vin: null,
      condition: 'used',
      sellerType: 'dealer',
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
      dealer: { name: null, phone: null, website: null },
      images: [],
      description: null,
      saleStatus: 'active',
      soldAt: null,
      listedAt: '2026-08-01T00:00:00.000Z',
    })
    expect(parsed.listedAt).toBeInstanceOf(Date)
    expect(parsed.sourceRecordKey).toBe('rec-1')
  })
})
