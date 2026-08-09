import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb, getDb } from '../index.js'
import type { PrismaClient } from '../generated/prisma/index.js'
import { recordClaim, getClaimsForListing, applyFieldResolution } from './claims-repository.js'
import { recordCardFieldClaims } from './card-claims.js'
import { recordDetailFieldClaims } from './detail-claims.js'
import { NoopPhotoClaimProvider } from './photo-claim-provider.js'
import type { PhotoClaimProvider } from './photo-claim-provider.js'
import type { ListingUpsertRequest as ListingUpsertData } from '@wivwav/types/scraper-gateway'

// Exercises #499's claim persistence + resolution against a real, migrated
// Postgres — resolver.test.ts covers the pure decision logic; this file
// covers the append-only idempotency contract and the Listing-row write-back
// that only a real Prisma transaction can verify.
const db: PrismaClient = getDb()
const photoNoop = new NoopPhotoClaimProvider()

async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "listing_field_claim", "listings", "sources" RESTART IDENTITY CASCADE
  `)
}

let sourceCounter = 0
async function createSource() {
  sourceCounter += 1
  return db.source.create({
    data: { name: `Claims Test Source ${sourceCounter}`, baseUrl: `https://source-${sourceCounter}.example.com` },
  })
}

let listingCounter = 0
async function createListing(sourceId: string) {
  listingCounter += 1
  return db.listing.create({
    data: {
      sourceId,
      sourceUrl: `https://source.example.com/listing-${listingCounter}`,
      sourceRecordKey: `key-${listingCounter}`,
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      condition: 'used',
      sellerType: 'dealer',
      listedAt: new Date('2026-01-01'),
    },
  })
}

function makeListingUpsertData(overrides: Partial<ListingUpsertData> = {}): ListingUpsertData {
  return {
    sourceId: 'src',
    sourceUrl: 'https://source.example.com/card',
    buyerUrl: null,
    externalId: null,
    stockNumber: null,
    sourceRecordKey: 'card-1',
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
    listedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('claims-repository (integration)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await resetDb()
    await disconnectDb()
  })

  describe('recordClaim', () => {
    it('does not create a duplicate claim for an unchanged observation', async () => {
      const source = await createSource()
      const listing = await createListing(source.id)

      const base = {
        listingId: listing.id,
        field: 'conversionType' as const,
        claimedValue: 'rear_entry',
        evidenceKind: 'structured_source' as const,
        sourceRef: listing.sourceUrl,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        extractorVersion: 'v1',
        confidence: null,
      }

      await db.$transaction((tx) => recordClaim(tx, base))
      await db.$transaction((tx) => recordClaim(tx, { ...base, observedAt: new Date('2026-01-02T00:00:00Z') }))

      const claims = await db.$transaction((tx) => getClaimsForListing(tx, listing.id, 'conversionType'))
      expect(claims).toHaveLength(1)
    })

    it('appends a new row (preserving history) when the value actually changes', async () => {
      const source = await createSource()
      const listing = await createListing(source.id)
      const base = {
        listingId: listing.id,
        field: 'conversionType' as const,
        evidenceKind: 'structured_source' as const,
        sourceRef: listing.sourceUrl,
        extractorVersion: 'v1',
        confidence: null,
      }

      await db.$transaction((tx) => recordClaim(tx, { ...base, claimedValue: 'side_entry', observedAt: new Date('2026-01-01T00:00:00Z') }))
      await db.$transaction((tx) => recordClaim(tx, { ...base, claimedValue: 'rear_entry', observedAt: new Date('2026-01-02T00:00:00Z') }))

      const claims = await db.$transaction((tx) => getClaimsForListing(tx, listing.id, 'conversionType'))
      expect(claims).toHaveLength(2)
    })
  })

  describe('applyFieldResolution', () => {
    it('writes the resolved value and resolution state back onto the Listing row', async () => {
      const source = await createSource()
      const listing = await createListing(source.id)

      await db.$transaction(async (tx) => {
        await recordClaim(tx, {
          listingId: listing.id,
          field: 'conversionType',
          claimedValue: 'rear_entry',
          evidenceKind: 'structured_source',
          sourceRef: listing.sourceUrl,
          observedAt: new Date(),
          extractorVersion: 'v1',
          confidence: null,
        })
        await applyFieldResolution(tx, listing.id, 'conversionType', photoNoop)
      })

      const updated = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
      expect(updated.conversionType).toBe('rear_entry')
      expect(updated.conversionTypeResolution).toBe('source_reported')
    })

    it('forces the normalized value to unknown while conflicting', async () => {
      const source = await createSource()
      const listing = await createListing(source.id)

      await db.$transaction(async (tx) => {
        await recordClaim(tx, {
          listingId: listing.id, field: 'conversionType', claimedValue: 'side_entry',
          evidenceKind: 'structured_source', sourceRef: 'card', observedAt: new Date('2026-01-01'),
          extractorVersion: 'v1', confidence: null,
        })
        await recordClaim(tx, {
          listingId: listing.id, field: 'conversionType', claimedValue: 'rear_entry',
          evidenceKind: 'vehicle_text', sourceRef: 'detail', observedAt: new Date('2026-01-02'),
          extractorVersion: 'v1', confidence: null,
        })
        await applyFieldResolution(tx, listing.id, 'conversionType', photoNoop)
      })

      const updated = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
      expect(updated.conversionType).toBe('unknown')
      expect(updated.conversionTypeResolution).toBe('conflicting')
    })
  })

  describe('recordCardFieldClaims + recordDetailFieldClaims (end-to-end)', () => {
    it('card and detail extraction produce independent claims that the resolver reconciles into a conflict', async () => {
      const source = await createSource()
      const listing = await createListing(source.id)

      const cardData = makeListingUpsertData({
        sourceUrl: listing.sourceUrl,
        wav: {
          conversionType: 'side_entry',
          conversionManufacturer: null,
          floorLoweringInches: null,
          rampType: 'unknown',
          conversionStatus: 'unknown',
          wavFeatures: [],
          wheelchairCapacity: null,
        },
      })
      await recordCardFieldClaims(db, listing.id, cardData)

      let updated = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
      expect(updated.conversionType).toBe('side_entry')
      expect(updated.conversionTypeResolution).toBe('source_reported')

      await recordDetailFieldClaims(
        db,
        listing.id,
        { conversionType: 'rear_entry', rampType: 'unknown' },
        `${listing.sourceUrl}/detail`,
        'detail-v1',
      )

      updated = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
      expect(updated.conversionType).toBe('unknown')
      expect(updated.conversionTypeResolution).toBe('conflicting')

      const claims = await db.$transaction((tx) => getClaimsForListing(tx, listing.id, 'conversionType'))
      expect(claims.map((c) => c.evidenceKind).sort()).toEqual(['structured_source', 'vehicle_text'])
    })

    it('a later corrected card observation resolves a prior conflict', async () => {
      const source = await createSource()
      const listing = await createListing(source.id)

      await recordCardFieldClaims(db, listing.id, makeListingUpsertData({
        sourceUrl: listing.sourceUrl,
        sourceRecordKey: 'k1',
        wav: { conversionType: 'side_entry', conversionManufacturer: null, floorLoweringInches: null, rampType: 'unknown', conversionStatus: 'unknown', wavFeatures: [], wheelchairCapacity: null },
      }))
      await recordDetailFieldClaims(db, listing.id, { conversionType: 'rear_entry', rampType: 'unknown' }, `${listing.sourceUrl}/detail`, 'detail-v1')

      let updated = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
      expect(updated.conversionTypeResolution).toBe('conflicting')

      // Dealer corrects the card to match the detail page.
      await recordCardFieldClaims(db, listing.id, makeListingUpsertData({
        sourceUrl: listing.sourceUrl,
        sourceRecordKey: 'k1',
        wav: { conversionType: 'rear_entry', conversionManufacturer: null, floorLoweringInches: null, rampType: 'unknown', conversionStatus: 'unknown', wavFeatures: [], wheelchairCapacity: null },
      }))

      updated = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
      expect(updated.conversionType).toBe('rear_entry')
      expect(updated.conversionTypeResolution).toBe('verified')
    })

    it('does not touch ListingFieldClaim when the card observed no accessibility evidence', async () => {
      const source = await createSource()
      const listing = await createListing(source.id)

      await recordCardFieldClaims(db, listing.id, makeListingUpsertData({ sourceUrl: listing.sourceUrl }))

      const claims = await db.$transaction((tx) => getClaimsForListing(tx, listing.id, 'conversionType'))
      expect(claims).toHaveLength(0)
    })

    it('consumes a credible injected photo claim through the provider-neutral interface, conflicting with side-entry text', async () => {
      const source = await createSource()
      const listing = await createListing(source.id)

      await recordDetailFieldClaims(db, listing.id, { conversionType: 'side_entry', rampType: 'unknown' }, `${listing.sourceUrl}/detail`, 'detail-v1')

      const rearEntryPhotoProvider: PhotoClaimProvider = {
        async getClaims(listingId, field) {
          if (field !== 'conversionType') return []
          return [{
            listingId,
            field: 'conversionType',
            claimedValue: 'rear_entry',
            evidenceKind: 'photo',
            sourceRef: 'https://cdn.example/photo-1.jpg',
            observedAt: new Date(),
            extractorVersion: 'photo-v1',
            confidence: 0.92,
          }]
        },
      }

      await db.$transaction(async (tx) => {
        await applyFieldResolution(tx, listing.id, 'conversionType', rearEntryPhotoProvider)
      })

      const updated = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
      expect(updated.conversionTypeResolution).toBe('conflicting')
    })

    it('does not re-run detail claim recording when a raw page observed no description (missing evidence != no claim)', async () => {
      // Verified at the detail-extract.ts call site (gated on descriptionObserved),
      // not inside recordDetailFieldClaims — this test documents that
      // recordDetailFieldClaims itself has no such gate; the caller owns it.
      const source = await createSource()
      const listing = await createListing(source.id)
      await recordDetailFieldClaims(db, listing.id, { conversionType: 'unknown', rampType: 'unknown' }, 'x', 'v1')
      const claims = await db.$transaction((tx) => getClaimsForListing(tx, listing.id, 'conversionType'))
      expect(claims).toHaveLength(0)
    })
  })
})
