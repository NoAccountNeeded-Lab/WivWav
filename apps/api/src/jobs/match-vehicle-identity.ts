import { getDb, upsertVehicleIdentityDecision, VehicleIdentityDecisionState } from '@wivwav/db'
import type { Listing, PrismaClient } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import {
  matchListingPair,
  type MatchableListing,
  type VehicleIdentityMatchResult,
} from '../engine/vehicle-identity-matcher.js'
import { report } from './job-progress.js'
import { acquireListingLock, releaseListingLocks } from './listing-lock.js'

/**
 * Non-VIN candidate matching job (issue #529).
 *
 * Pairs listings that lack a `vehicleId` (i.e. were not already grouped by the
 * VIN-based `deduplicate` job) within the same make/model/year bucket, scores
 * each pair with `matchListingPair`, and persists every `auto_link` or
 * `candidate` decision via `upsertVehicleIdentityDecision` (idempotent by
 * listing pair, so retried jobs reuse the same rows rather than duplicating
 * them). `no_match` pairs are not persisted.
 *
 * Auto-linked pairs are assigned a shared `vehicleId`: an existing vehicle
 * from either listing (if one was already created by a prior auto-link in
 * this run) is reused; otherwise a new non-VIN `Vehicle` row is created.
 * Candidate pairs are left for operator/automated review (#504) and do not
 * mutate `Listing.vehicleId`.
 */
export async function runMatchVehicleIdentityJob(context?: JobContext): Promise<void> {
  const db = getDb()

  // dealerProfileId is already a column on Listing — no join needed for the
  // stable-identifier check.
  const unmatched = await db.listing.findMany({
    where: { vehicleId: null, status: 'active' },
  })

  const buckets = new Map<string, Listing[]>()
  for (const listing of unmatched) {
    const key = `${listing.make.trim().toLowerCase()}|${listing.model.trim().toLowerCase()}|${listing.year}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(listing)
    else buckets.set(key, [listing])
  }

  const pairBuckets = [...buckets.values()].filter((bucket) => bucket.length > 1)
  const totalPairs = pairBuckets.reduce((sum, bucket) => sum + (bucket.length * (bucket.length - 1)) / 2, 0)

  await report(context, `[match-vehicle-identity] ${unmatched.length} unmatched listing(s), ${totalPairs} candidate pair(s) across ${pairBuckets.length} bucket(s)`, {
    stage: 'matching',
    current: 0,
    total: totalPairs,
  })

  let autoLinked = 0
  let candidates = 0
  let processed = 0
  const touchedIds: string[] = []

  for (const bucket of pairBuckets) {
    // vehicleId assigned so far within THIS bucket's run, keyed by listing id —
    // lets a chain of auto-links (A-B, then B-C) converge on one vehicle.
    const assignedVehicleId = new Map<string, string>()

    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const listingA = bucket[i]!
        const listingB = bucket[j]!
        processed++

        const result = matchListingPair(toMatchable(listingA), toMatchable(listingB))

        if (result.decision === 'no_match') continue

        if (result.decision === 'candidate') {
          await upsertVehicleIdentityDecision(db, {
            listingAId: listingA.id,
            listingBId: listingB.id,
            state: VehicleIdentityDecisionState.candidate,
            signals: signalsToJson(result),
            ruleId: result.ruleId,
          })
          candidates++
          continue
        }

        // auto_link
        const lockedIds: string[] = []
        const acquiredA = await acquireListingLock(db, listingA.id)
        if (acquiredA) lockedIds.push(listingA.id)
        const acquiredB = acquiredA ? await acquireListingLock(db, listingB.id) : false
        if (acquiredB) lockedIds.push(listingB.id)

        if (!acquiredA || !acquiredB) {
          await releaseListingLocks(db, lockedIds)
          // Locked by another concurrent job — skip this pair for now; it will
          // be retried on the next run (idempotent — no partial state written).
          continue
        }

        try {
          const vehicleId = await resolveAutoLinkVehicleId(db, listingA, listingB, assignedVehicleId)

          // Audit signal: a stable-identifier match disagreeing with a prior
          // auto-link is rare (the gate is conservative) but should never be
          // silent — record it on the decision for operator visibility even
          // though the matcher itself proceeds with the resolved vehicleId.
          const reassignedFrom = [listingA, listingB]
            .filter((l) => l.vehicleId && l.vehicleId !== vehicleId)
            .map((l) => `${l.id}:${l.vehicleId}`)

          await upsertVehicleIdentityDecision(db, {
            listingAId: listingA.id,
            listingBId: listingB.id,
            vehicleId,
            state: VehicleIdentityDecisionState.verified,
            signals: {
              ...signalsToJson(result),
              ...(reassignedFrom.length > 0 ? { reassignedFrom } : {}),
            },
            ruleId: result.ruleId,
          })

          for (const listing of [listingA, listingB]) {
            if (listing.vehicleId !== vehicleId) {
              await db.listing.update({ where: { id: listing.id }, data: { vehicleId } })
              touchedIds.push(listing.id)
            }
            assignedVehicleId.set(listing.id, vehicleId)
          }
          autoLinked++
        } finally {
          await releaseListingLocks(db, lockedIds)
        }
      }
    }

    await report(context, `[match-vehicle-identity] processed ${processed}/${totalPairs} pair(s)`, {
      stage: 'matching',
      current: processed,
      total: totalPairs,
    })
  }

  // Search-index sync is no longer this job's concern — the single-owner
  // indexer poller (#669) picks up any touched listing on its next tick.
  await report(
    context,
    `[match-vehicle-identity] Done. ${autoLinked} pair(s) auto-linked, ${candidates} candidate(s) recorded, ${touchedIds.length} listing(s) updated.`,
    { stage: 'complete', current: totalPairs, total: totalPairs },
  )
  await db.$disconnect()
}

function toMatchable(listing: Listing): MatchableListing {
  return {
    id: listing.id,
    sourceId: listing.sourceId,
    dealerProfileId: listing.dealerProfileId,
    dealerWebsite: listing.dealerWebsite,
    dealerName: listing.dealerName,
    stockNumber: listing.stockNumber,
    sourceUrl: listing.sourceUrl,
    make: listing.make,
    model: listing.model,
    year: listing.year,
    trim: listing.trim,
    vin: listing.vin,
    mileage: listing.mileage,
    priceCents: listing.priceCents,
    zip: listing.zip,
    city: listing.city,
    state: listing.state,
  }
}

function signalsToJson(result: VehicleIdentityMatchResult): {
  score: number
  stableIdentifierMatch: boolean
  signals: { id: string; detail: string; weight: number }[]
} {
  return {
    score: result.score,
    stableIdentifierMatch: result.stableIdentifierMatch,
    signals: result.signals.map((s) => ({ id: s.id, detail: s.detail, weight: s.weight })),
  }
}

/**
 * Resolve the vehicleId an auto-linked pair should share: reuse whichever
 * listing already has a vehicleId (from this run's chain or a prior run),
 * preferring listingA, otherwise create a new non-VIN vehicle.
 */
async function resolveAutoLinkVehicleId(
  db: PrismaClient,
  listingA: Listing,
  listingB: Listing,
  assignedVehicleId: Map<string, string>,
): Promise<string> {
  const existing =
    assignedVehicleId.get(listingA.id) ?? listingA.vehicleId
    ?? assignedVehicleId.get(listingB.id) ?? listingB.vehicleId
  if (existing) return existing

  const vehicle = await db.vehicle.create({
    data: {
      vin: null,
      make: listingA.make,
      model: listingA.model,
      year: listingA.year,
      trim: listingA.trim,
      firstSeenAt: listingA.scrapedAt,
      lastSeenAt: listingA.scrapedAt > listingB.scrapedAt ? listingA.scrapedAt : listingB.scrapedAt,
    },
  })
  return vehicle.id
}
