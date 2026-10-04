import type { PrismaClient } from '@wivwav/db'
import { apiBaseUrl, e2eEnv } from './compose.js'
import { fixtureListingId, fixtureSourceId, withE2eDb } from './fixture-db.js'
import { poll, syncSearchIndex, waitForSyncJobToComplete } from './fixture.js'

/**
 * Removes the deterministic smoke fixture (and nothing else) from the
 * database, children before parents. Idempotent: deleting absent rows is a
 * no-op, so it is safe to call from both setup-failure and teardown paths.
 */
export async function deleteSmokeFixtureRows(db: PrismaClient): Promise<void> {
  const listingIds = { in: [fixtureListingId] }
  await db.$transaction([
    db.listingImageSemanticAnalysis.deleteMany({
      where: { listingImage: { listingId: listingIds } },
    }),
    db.listingImage.deleteMany({ where: { listingId: listingIds } }),
    db.listingObservation.deleteMany({ where: { listingId: listingIds } }),
    db.listingPriceHistory.deleteMany({ where: { listingId: listingIds } }),
    db.listingMileageHistory.deleteMany({ where: { listingId: listingIds } }),
    db.listingConversionHistory.deleteMany({ where: { listingId: listingIds } }),
    db.listingFieldClaim.deleteMany({ where: { listingId: listingIds } }),
    db.listingReport.deleteMany({ where: { listingId: listingIds } }),
    db.vehicleIdentityDecision.deleteMany({
      where: { OR: [{ listingAId: listingIds }, { listingBId: listingIds }] },
    }),
    // Unrelated listings that were deduplicated onto the fixture keep their row.
    db.listing.updateMany({
      where: { canonicalId: fixtureListingId },
      data: { canonicalId: null },
    }),
    db.listing.deleteMany({ where: { id: fixtureListingId } }),
    db.jobRun.deleteMany({ where: { sourceId: fixtureSourceId } }),
    db.scraperRun.deleteMany({ where: { sourceId: fixtureSourceId } }),
    db.rawPage.deleteMany({ where: { sourceId: fixtureSourceId } }),
    db.source.deleteMany({ where: { id: fixtureSourceId } }),
  ])
}

async function fixtureIsPublic(): Promise<boolean> {
  const response = await fetch(`${apiBaseUrl()}/v1/listings?q=Sienna`, {
    headers: { authorization: `Bearer ${e2eEnv.internalApiSecret}` },
  })
  if (!response.ok) throw new Error(`Public search request failed: ${response.status}`)
  const body = (await response.json()) as { data?: Array<{ id?: string }> }
  return body.data?.some((listing) => listing.id === fixtureListingId) ?? false
}

/**
 * Cleanup for a reused (WIVWAV_E2E_SKIP_COMPOSE=1) stack, where Compose
 * volume removal does not run: delete the fixture rows, then rebuild the
 * search index and wait until the smoke listing is no longer returned.
 */
export async function cleanupReusedStackFixture(): Promise<void> {
  await withE2eDb(deleteSmokeFixtureRows)
  const jobId = await syncSearchIndex()
  await waitForSyncJobToComplete(jobId)
  await poll(async () => !(await fixtureIsPublic()), 'fixture listing to leave search')
}
