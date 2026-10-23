/**
 * Dealer site candidate backfill (#1178, slice 1 of #1042).
 *
 * Walks existing `Listing.dealerWebsite` and `DealerProfile.website` values
 * through the same normalization and denylist as the live capture paths and
 * upserts `dealer_site_candidate` rows, then links each listing via
 * `Listing.dealerSiteCandidateId` (null for missing or rejected websites).
 * Membership only, no count writes, so it cannot race live writers. Idempotent:
 * existing `lastSeenAt` values are left alone and re-running sets the same links.
 *
 * Collection only: no Source is created and no candidate site is fetched.
 *
 * Usage: pnpm tsx apps/api/src/jobs/dealer-site-candidate-backfill.ts
 *
 * @module
 */

import '../lib/load-env.js'

import { getDb, normalizeDealerSiteOrigin, recordDealerSiteCandidate, type PrismaClient } from '@wivwav/db'

const BATCH_SIZE = 500

export interface DealerSiteBackfillResult {
  /** Distinct origins found on listings. */
  listingOrigins: number
  /** Dealer profiles whose website produced a (possibly already existing) candidate. */
  profilesRecorded: number
}

export async function backfillDealerSiteCandidates(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<DealerSiteBackfillResult> {
  const origins = new Set<string>()
  const candidateIds = new Map<string, string>()
  let cursor: string | undefined
  for (;;) {
    const rows = await db.listing.findMany({
      where: { OR: [{ dealerWebsite: { not: null } }, { dealerSiteCandidateId: { not: null } }] },
      select: { id: true, dealerWebsite: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor !== undefined && { cursor: { id: cursor }, skip: 1 }),
    })
    if (rows.length === 0) break
    // candidate id (null = unlink) -> listing ids in this batch
    const byCandidate = new Map<string | null, string[]>()
    for (const row of rows) {
      let candidateId: string | null = null
      const origin = normalizeDealerSiteOrigin(row.dealerWebsite)
      if (origin !== null && row.dealerWebsite !== null) {
        origins.add(origin)
        candidateId = candidateIds.get(origin) ?? null
        if (candidateId === null) {
          const recorded = await recordDealerSiteCandidate(db, {
            rawUrl: row.dealerWebsite,
            discoveredVia: 'listing_dealer_website',
            now,
            touchLastSeen: false,
          })
          candidateId = recorded?.id ?? null
          if (candidateId !== null) candidateIds.set(origin, candidateId)
        }
      }
      byCandidate.set(candidateId, [...(byCandidate.get(candidateId) ?? []), row.id])
    }
    for (const [candidateId, ids] of byCandidate) {
      await db.listing.updateMany({ where: { id: { in: ids } }, data: { dealerSiteCandidateId: candidateId } })
    }
    cursor = rows[rows.length - 1]!.id
  }

  let profilesRecorded = 0
  const profiles = await db.dealerProfile.findMany({
    where: { website: { not: null } },
    select: { id: true, name: true, website: true },
    orderBy: { id: 'asc' },
  })
  for (const profile of profiles) {
    const recorded = await recordDealerSiteCandidate(db, {
      rawUrl: profile.website,
      discoveredVia: 'google_places',
      now,
      dealerProfileId: profile.id,
      dealerName: profile.name,
      touchLastSeen: false,
    })
    if (recorded !== null) profilesRecorded++
  }

  return { listingOrigins: origins.size, profilesRecorded }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  backfillDealerSiteCandidates(getDb())
    .then((result) => {
      console.log('Dealer site candidate backfill done:', result)
    })
    .catch((err: unknown) => {
      console.error('Backfill failed:', err)
      process.exit(1)
    })
}
