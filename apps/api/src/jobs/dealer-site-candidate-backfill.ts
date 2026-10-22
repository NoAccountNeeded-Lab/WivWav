/**
 * Dealer site candidate backfill (#1178, slice 1 of #1042).
 *
 * Walks existing `Listing.dealerWebsite` and `DealerProfile.website` values
 * through the same normalization and denylist as the live capture paths and
 * upserts `dealer_site_candidate` rows. Idempotent: listing counts are
 * recomputed (set, not incremented) and existing `lastSeenAt` values are left
 * alone, so re-running on unchanged data leaves identical rows.
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
  const byOrigin = new Map<string, { sampleUrl: string; listingIds: Set<string> }>()
  let cursor: string | undefined
  for (;;) {
    const rows = await db.listing.findMany({
      where: { dealerWebsite: { not: null } },
      select: { id: true, dealerWebsite: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor !== undefined && { cursor: { id: cursor }, skip: 1 }),
    })
    if (rows.length === 0) break
    for (const row of rows) {
      const origin = normalizeDealerSiteOrigin(row.dealerWebsite)
      if (origin === null || row.dealerWebsite === null) continue
      const entry = byOrigin.get(origin) ?? { sampleUrl: row.dealerWebsite, listingIds: new Set<string>() }
      entry.listingIds.add(row.id)
      byOrigin.set(origin, entry)
    }
    cursor = rows[rows.length - 1]!.id
  }

  for (const entry of byOrigin.values()) {
    await recordDealerSiteCandidate(db, {
      rawUrl: entry.sampleUrl,
      discoveredVia: 'listing_dealer_website',
      now,
      listingCount: { set: entry.listingIds.size },
      touchLastSeen: false,
    })
  }

  let profilesRecorded = 0
  const profiles = await db.dealerProfile.findMany({
    where: { website: { not: null } },
    select: { id: true, name: true, website: true },
    orderBy: { id: 'asc' },
  })
  for (const profile of profiles) {
    const origin = await recordDealerSiteCandidate(db, {
      rawUrl: profile.website,
      discoveredVia: 'google_places',
      now,
      dealerProfileId: profile.id,
      dealerName: profile.name,
      touchLastSeen: false,
    })
    if (origin !== null) profilesRecorded++
  }

  return { listingOrigins: byOrigin.size, profilesRecorded }
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
