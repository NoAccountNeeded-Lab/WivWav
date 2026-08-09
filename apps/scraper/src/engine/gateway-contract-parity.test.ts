import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { AssertTrue, MutuallyAssignable } from '@wivwav/types'
import type {
  blvdDealerEnrichmentSchema,
  detailResultSchema,
  listingStatusSchema,
  listingUpsertResponseSchema,
  publicationStatusSchema,
  sourceDriftBaselineSchema,
  sourceExecutionStateSchema,
} from '@wivwav/types/scraper-gateway'
import { listingUpsertRequestSchema } from '@wivwav/types/scraper-gateway'
import type {
  Listing as DbListingRow,
  ListingPublicationStatus as DbListingPublicationStatus,
} from '@wivwav/db'
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
 * hand-written shapes they mirror (#948/#949) — including the Prisma enums
 * the schemas claim to mirror. If a field or enum member is added, removed,
 * or retyped on either side, `tsc` fails here. See @wivwav/types'
 * type-parity.js for how MutuallyAssignable treats optional properties.
 */
export type _ListingUpsertRequestParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof listingUpsertRequestSchema>, ListingUpsertData>
>
export type _ListingUpsertResponseParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof listingUpsertResponseSchema>, ListingUpsertResult>
>
export type _SourceExecutionStateParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof sourceExecutionStateSchema>, SourceExecutionState>
>
export type _SourceDriftBaselineParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof sourceDriftBaselineSchema>, SourceDriftBaseline>
>
export type _DetailResultParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof detailResultSchema>, DetailResult>
>
export type _BlvdDealerEnrichmentParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof blvdDealerEnrichmentSchema>, BlvdDealerEnrichment>
>
export type _ListingStatusPrismaParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof listingStatusSchema>, DbListingRow['status']>
>
export type _ListingPublicationStatusPrismaParity = AssertTrue<
  MutuallyAssignable<z.infer<typeof publicationStatusSchema>, DbListingPublicationStatus>
>

describe('gateway contract parity', () => {
  it('should accept a schema-parsed upsert payload as ListingUpsertData', () => {
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
    expect(parsed.listedAt).toEqual(new Date('2026-08-01T00:00:00.000Z'))
  })
})
