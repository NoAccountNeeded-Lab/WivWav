import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb, getDb } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import { CURRENT_SEMANTIC_ANALYSIS_VERSION } from './semantic-image-analysis.js'
import { findEligibleImagesForSemanticAnalysis } from './semantic-analysis-eligibility.js'

// Exercises #798's eligibility + staleness scan against a real, migrated
// Postgres — the cluster join and the OR/AND staleness predicate combination
// are worth verifying against a real query planner, not a mocked client.
const db: PrismaClient = getDb()

async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "listing_image_semantic_analysis", "listing_image", "image_cluster", "listings", "sources" RESTART IDENTITY CASCADE
  `)
}

let sourceCounter = 0
async function createSource() {
  sourceCounter += 1
  return db.source.create({
    data: { name: `Eligibility Test Source ${sourceCounter}`, baseUrl: `https://source-${sourceCounter}.example.com` },
  })
}

let listingCounter = 0
async function createListing(sourceId: string, status: 'active' | 'possibly_gone' | 'gone' = 'active') {
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
      status,
    },
  })
}

let clusterCounter = 0
async function createCluster(opts: { isPlaceholder?: boolean; crossVehicle?: boolean }) {
  clusterCounter += 1
  return db.imageCluster.create({
    data: {
      clusterType: 'exact',
      representativeHash: `hash-${clusterCounter}`,
      isPlaceholder: opts.isPlaceholder ?? false,
      crossVehicle: opts.crossVehicle ?? false,
    },
  })
}

let imageCounter = 0
async function createListingImage(
  listingId: string,
  opts: {
    kind?: 'vehicle_photo' | 'placeholder' | 'site_chrome' | 'excluded'
    clusterId?: string | null
    semanticAnalysisVersion?: number | null
  } = {},
) {
  imageCounter += 1
  return db.listingImage.create({
    data: {
      listingId,
      originalUrl: `https://source.example.com/photo-${imageCounter}.jpg`,
      normalizedUrl: `https://source.example.com/photo-${imageCounter}.jpg`,
      position: 0,
      kind: opts.kind ?? 'vehicle_photo',
      ...(opts.clusterId !== undefined ? { clusterId: opts.clusterId } : {}),
      ...(opts.semanticAnalysisVersion !== undefined
        ? { semanticAnalysisVersion: opts.semanticAnalysisVersion }
        : {}),
    },
  })
}

describe('findEligibleImagesForSemanticAnalysis', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('includes an unanalyzed vehicle photo with no cluster', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const image = await createListingImage(listing.id)

    const results = await findEligibleImagesForSemanticAnalysis(db)

    expect(results.map((r) => r.id)).toEqual([image.id])
  })

  it('excludes images from a placeholder cluster', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const cluster = await createCluster({ isPlaceholder: true })
    await createListingImage(listing.id, { clusterId: cluster.id })

    const results = await findEligibleImagesForSemanticAnalysis(db)

    expect(results).toEqual([])
  })

  it('excludes images from a cross-vehicle cluster', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const cluster = await createCluster({ crossVehicle: true })
    await createListingImage(listing.id, { clusterId: cluster.id })

    const results = await findEligibleImagesForSemanticAnalysis(db)

    expect(results).toEqual([])
  })

  it('includes images from a legitimate (non-placeholder, non-cross-vehicle) cluster', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const cluster = await createCluster({})
    const image = await createListingImage(listing.id, { clusterId: cluster.id })

    const results = await findEligibleImagesForSemanticAnalysis(db)

    expect(results.map((r) => r.id)).toEqual([image.id])
  })

  it('excludes non-vehicle_photo kinds', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    await createListingImage(listing.id, { kind: 'site_chrome' })
    await createListingImage(listing.id, { kind: 'placeholder' })
    await createListingImage(listing.id, { kind: 'excluded' })

    const results = await findEligibleImagesForSemanticAnalysis(db)

    expect(results).toEqual([])
  })

  it('excludes images from non-active listings', async () => {
    const source = await createSource()
    const listing = await createListing(source.id, 'gone')
    await createListingImage(listing.id)

    const results = await findEligibleImagesForSemanticAnalysis(db)

    expect(results).toEqual([])
  })

  it('excludes an image already analyzed at the current semantic version', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    await createListingImage(listing.id, { semanticAnalysisVersion: CURRENT_SEMANTIC_ANALYSIS_VERSION })

    const results = await findEligibleImagesForSemanticAnalysis(db)

    expect(results).toEqual([])
  })

  it('includes an image analyzed at a stale semantic version', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    const image = await createListingImage(listing.id, {
      semanticAnalysisVersion: CURRENT_SEMANTIC_ANALYSIS_VERSION - 1,
    })

    const results = await findEligibleImagesForSemanticAnalysis(db)

    expect(results.map((r) => r.id)).toEqual([image.id])
  })

  it('scopes to a single source when sourceId is given', async () => {
    const sourceA = await createSource()
    const sourceB = await createSource()
    const listingA = await createListing(sourceA.id)
    const listingB = await createListing(sourceB.id)
    const imageA = await createListingImage(listingA.id)
    await createListingImage(listingB.id)

    const results = await findEligibleImagesForSemanticAnalysis(db, { sourceId: sourceA.id })

    expect(results.map((r) => r.id)).toEqual([imageA.id])
  })

  it('bounds results with limit', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    await createListingImage(listing.id)
    await createListingImage(listing.id)
    await createListingImage(listing.id)

    const results = await findEligibleImagesForSemanticAnalysis(db, { limit: 2 })

    expect(results).toHaveLength(2)
  })
})
