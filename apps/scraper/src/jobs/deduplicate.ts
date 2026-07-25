import { checkDigitValid, findOrCreateVehicle, getDb, isValidVin, normalizeVin } from '@wivwav/db'
import type { Listing } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import type { JobRunFinishStats } from '../lib/job-run-repository.js'
import { report } from './job-progress.js'
import { acquireListingLock, releaseListingLocks } from './listing-lock.js'

/** Count non-null optional fields as a completeness score. */
function completenessScore(listing: Listing): number {
  const optionalFields: (keyof Listing)[] = [
    'trim',
    'vin',
    'priceCents',
    'mileage',
    'color',
    'fuelType',
    'transmission',
    'conversionManufacturer',
    'floorLoweringInches',
    'wheelchairCapacity',
    'zip',
    'city',
    'state',
    'lat',
    'lng',
    'dealerName',
    'dealerPhone',
    'dealerWebsite',
    'description',
    'detailScrapedAt',
  ]
  return optionalFields.filter((f) => listing[f] != null).length + listing.images.length
}

export async function runDeduplicateJob(context?: JobContext): Promise<JobRunFinishStats> {
  const db = getDb()

  // Find all VINs shared by two or more listings, regardless of source —
  // same-source re-scrapes/re-posts are grouped the same as cross-source matches.
  const rows = await db.$queryRaw<{ vin: string }[]>`
    SELECT vin
    FROM listings
    WHERE vin IS NOT NULL AND vin <> ''
    GROUP BY vin
    HAVING COUNT(*) > 1
  `

  await report(context, `[deduplicate] ${rows.length} VIN(s) have duplicate listings`, {
    stage: 'deduplicating',
    current: 0,
    total: rows.length,
  })

  let vehicleGroupsLinked = 0
  let listingsLinked = 0
  let skippedGroups = 0

  for (let i = 0; i < rows.length; i++) {
    const rawVin = rows[i]!.vin
    const vin = normalizeVin(rawVin)
    if (!isValidVin(vin) || !checkDigitValid(vin)) {
      skippedGroups++
      await report(context, `[deduplicate] ${i + 1}/${rows.length} VIN group(s) — VIN ${rawVin}: invalid VIN, skipping group`, {
        stage: 'deduplicating',
        current: i + 1,
        total: rows.length,
      })
      continue
    }

    const group = await db.listing.findMany({ where: { vin: rawVin } })

    // Acquire a lock on every listing in this VIN group before mutating them.
    // If any listing is actively locked by another job, skip the entire group
    // to avoid partial deduplication (which could leave inconsistent canonical pointers).
    const lockedIds: string[] = []
    let groupLockFailed = false

    for (const listing of group) {
      const acquired = await acquireListingLock(db, listing.id)
      if (acquired) {
        lockedIds.push(listing.id)
      } else {
        groupLockFailed = true
        break
      }
    }

    if (groupLockFailed) {
      // Release any partially acquired locks and skip this group
      await releaseListingLocks(db, lockedIds)
      skippedGroups++
      await report(context, `[deduplicate] ${i + 1}/${rows.length} VIN group(s) — VIN ${vin}: one or more listings locked, skipping group`, {
        stage: 'deduplicating',
        current: i + 1,
        total: rows.length,
      })
      continue
    }

    // Pick the listing with the highest completeness score as the vehicle identity seed.
    const sorted = [...group].sort((a, b) => completenessScore(b) - completenessScore(a))
    const representative = sorted[0]!
    const latestObservedAt = sorted.reduce(
      (latest, listing) => listing.scrapedAt > latest ? listing.scrapedAt : latest,
      representative.scrapedAt,
    )

    try {
      const vehicle = await findOrCreateVehicle(db, {
        vin,
        make: representative.make,
        model: representative.model,
        year: representative.year,
        trim: representative.trim,
        vehicleModelId: representative.vehicleModelId,
        observedAt: latestObservedAt,
      })

      for (const listing of sorted) {
        await db.listing.update({
          where: { id: listing.id },
          data: { vehicleId: vehicle.id },
        })
        listingsLinked++
      }
      vehicleGroupsLinked++
    } finally {
      await releaseListingLocks(db, lockedIds)
    }

    await report(context, `[deduplicate] Processed ${i + 1}/${rows.length} VIN group(s)`, {
      stage: 'deduplicating',
      current: i + 1,
      total: rows.length,
    })
  }

  // Search-index sync is no longer this job's concern — the single-owner
  // indexer poller (#669) picks up any touched listing on its next tick.
  await report(context, `[deduplicate] Done. ${vehicleGroupsLinked} vehicle group(s) linked, ${listingsLinked} listing(s) assigned vehicleId, ${skippedGroups} group(s) skipped.`, {
    stage: 'complete',
    current: rows.length,
    total: rows.length,
  })
  await db.$disconnect()

  // succeededCount/failedCount are per VIN group (this run's unit of work),
  // not per listing — a linked group can move several listings, so
  // listingsLinked would overstate "how many groups this run resolved".
  return { succeededCount: vehicleGroupsLinked, failedCount: skippedGroups }
}
