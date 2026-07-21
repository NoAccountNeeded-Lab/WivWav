import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb, getDb } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import { analyzeListingImage, CURRENT_SEMANTIC_ANALYSIS_VERSION } from './semantic-image-analysis.js'
import type { ImageAnalysisInput, ImageAnalysisProvider, ImageAnalysisResult } from './image-analysis-provider.js'

// Exercises #797's first semantic-image-analysis slice against a real,
// migrated Postgres — the append-only idempotency contract and the
// no-fabrication-on-error guarantee both need a real unique-constraint
// round trip to verify (a mocked Prisma client can't catch a bad unique key).
const db: PrismaClient = getDb()

async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "listing_image_semantic_analysis", "listing_image", "listings", "sources" RESTART IDENTITY CASCADE
  `)
}

let sourceCounter = 0
async function createSource() {
  sourceCounter += 1
  return db.source.create({
    data: { name: `Semantic Analysis Test Source ${sourceCounter}`, baseUrl: `https://source-${sourceCounter}.example.com` },
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

let imageCounter = 0
async function createListingImage(listingId: string) {
  imageCounter += 1
  return db.listingImage.create({
    data: {
      listingId,
      originalUrl: `https://source.example.com/photo-${imageCounter}.jpg`,
      normalizedUrl: `https://source.example.com/photo-${imageCounter}.jpg`,
      position: 0,
    },
  })
}

const RAMP_RESULT: ImageAnalysisResult = {
  schemaVersion: '1',
  altText: 'A wheelchair ramp deployed from the side door of a minivan.',
  summary: 'Side-entry ramp clearly visible.',
  labels: [{ label: 'ramp', confidence: 0.87 }],
  fieldClaims: [{ field: 'rampType', claimedValue: 'side_entry', confidence: 0.87 }],
}

/** Test double that always returns the given result, counting calls. */
class StubImageAnalysisProvider implements ImageAnalysisProvider {
  readonly name = 'stub'
  readonly model = 'stub-vision-1'
  callCount = 0
  constructor(private readonly result: ImageAnalysisResult) {}

  async analyze(input: ImageAnalysisInput): Promise<ImageAnalysisResult> {
    this.callCount += 1
    return { ...this.result, schemaVersion: input.schemaVersion }
  }
}

/** Test double simulating a provider that returns a malformed/invalid payload. */
class MalformedImageAnalysisProvider implements ImageAnalysisProvider {
  readonly name = 'malformed-stub'
  readonly model = 'stub-vision-1'
  callCount = 0

  async analyze(): Promise<ImageAnalysisResult> {
    this.callCount += 1
    // Cast through unknown: simulates a provider whose runtime response
    // doesn't actually satisfy ImageAnalysisResult (e.g. bad JSON shape).
    return { labels: 'ramp' } as unknown as ImageAnalysisResult
  }
}

/** Test double simulating a provider whose call throws (network/vendor error). */
class ThrowingImageAnalysisProvider implements ImageAnalysisProvider {
  readonly name = 'throwing-stub'
  readonly model = null

  async analyze(): Promise<ImageAnalysisResult> {
    throw new Error('vendor 500')
  }
}

describe('analyzeListingImage', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('should store a success record with the ramp label and a confidence score for a ramp-visible fixture', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const image = await createListingImage(listing.id)
    const provider = new StubImageAnalysisProvider(RAMP_RESULT)

    const row = await analyzeListingImage(db, provider, {
      listingImageId: image.id,
      contentHash: 'sha256-ramp-fixture',
      imageBytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
    })

    expect(row.status).toBe('success')
    expect(row.labels).toEqual([{ label: 'ramp', confidence: 0.87 }])

    const updatedImage = await db.listingImage.findUniqueOrThrow({ where: { id: image.id } })
    expect(updatedImage.semanticAnalysisVersion).toBe(CURRENT_SEMANTIC_ANALYSIS_VERSION)
  })

  it('should produce exactly one stored record when run twice for the same image content and semantic version', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const image = await createListingImage(listing.id)
    const provider = new StubImageAnalysisProvider(RAMP_RESULT)

    await analyzeListingImage(db, provider, {
      listingImageId: image.id,
      contentHash: 'sha256-ramp-fixture',
      imageBytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
    })
    await analyzeListingImage(db, provider, {
      listingImageId: image.id,
      contentHash: 'sha256-ramp-fixture',
      imageBytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
    })

    const rows = await db.listingImageSemanticAnalysis.findMany({ where: { listingImageId: image.id } })
    expect(rows).toHaveLength(1)
    // The second run should short-circuit on the existing row rather than
    // spending another provider call.
    expect(provider.callCount).toBe(1)
  })

  it('should store a failure record with no fabricated label/confidence when the provider throws', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const image = await createListingImage(listing.id)
    const provider = new ThrowingImageAnalysisProvider()

    const row = await expect(
      analyzeListingImage(db, provider, {
        listingImageId: image.id,
        contentHash: 'sha256-broken-fixture',
        imageBytes: new Uint8Array([9, 9, 9]),
        contentType: 'image/jpeg',
      }),
    ).resolves.toMatchObject({ status: 'error', errorCode: 'provider_error' })

    const rows = await db.listingImageSemanticAnalysis.findMany({ where: { listingImageId: image.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.labels).toEqual([])
    expect(rows[0]?.fieldClaims).toEqual([])

    const updatedImage = await db.listingImage.findUniqueOrThrow({ where: { id: image.id } })
    expect(updatedImage.semanticAnalysisVersion).toBeNull()
    void row
  })

  it('should store a failure record with no fabricated label/confidence for a malformed provider response', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const image = await createListingImage(listing.id)
    const provider = new MalformedImageAnalysisProvider()

    const row = await analyzeListingImage(db, provider, {
      listingImageId: image.id,
      contentHash: 'sha256-malformed-fixture',
      imageBytes: new Uint8Array([4, 5, 6]),
      contentType: 'image/jpeg',
    })

    expect(row.status).toBe('error')
    expect(row.errorCode).toBe('malformed_response')
    expect(row.labels).toEqual([])
    expect(row.fieldClaims).toEqual([])

    const updatedImage = await db.listingImage.findUniqueOrThrow({ where: { id: image.id } })
    expect(updatedImage.semanticAnalysisVersion).toBeNull()
  })

  it('should not read or write Listing.rampType/rampTypeResolution', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const image = await createListingImage(listing.id)
    const provider = new StubImageAnalysisProvider(RAMP_RESULT)

    await analyzeListingImage(db, provider, {
      listingImageId: image.id,
      contentHash: 'sha256-ramp-fixture',
      imageBytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
    })

    const updatedListing = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
    expect(updatedListing.rampType).toBe(listing.rampType)
    expect(updatedListing.rampTypeResolution).toBe(listing.rampTypeResolution)
  })
})
