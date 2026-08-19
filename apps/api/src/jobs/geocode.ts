import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'
import { acquireListingLock, releaseListingLocks, unlockableWhere } from './listing-lock.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const RATE_LIMIT_MS = 1100 // Nominatim policy: max 1 req/sec

interface NominatimResult {
  lat: string
  lon: string
}

async function geocode(city: string, state: string): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    q: `${city}, ${state}, USA`,
    format: 'json',
    limit: '1',
  })

  let res: Response
  try {
    res = await fetchWithRetry(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
    })
  } catch {
    // fetchWithRetry throws on non-ok responses after exhausting retries; treat as no result
    return null
  }

  // apps/scraper's tsconfig includes the DOM lib, so `Response.json()` there
  // resolves to `Promise<any>`; apps/api's does not, so it resolves to
  // `Promise<unknown>` from @types/node's fetch types instead — cast rather
  // than add the DOM lib app-wide for one call site.
  const results = (await res.json()) as NominatimResult[]
  if (results.length === 0) return null

  return { lat: parseFloat(results[0]!.lat), lng: parseFloat(results[0]!.lon) }
}


export async function runGeocodeJob(context?: JobContext): Promise<void> {
  const db = getDb()

  // Exclude listings locked by another concurrent job (e.g. vin-enrich).
  // Note: unlockableWhere() spreads an OR key — do not add a top-level OR
  // to this where clause or it will be silently overwritten by the spread.
  const listings = await db.listing.findMany({
    where: {
      lat: null,
      city: { not: null },
      state: { not: null },
      ...unlockableWhere(),
    },
    select: { id: true, city: true, state: true },
  })

  // Group by unique city+state — one Nominatim call per location, not per listing.
  // Many listings share a city (e.g. 200 listings in "Tampa, FL") so this can
  // reduce requests by 10-50x compared to geocoding each row individually.
  const byLocation = new Map<string, string[]>()
  for (const l of listings) {
    const key = `${l.city}|${l.state}`
    const ids = byLocation.get(key) ?? []
    ids.push(l.id)
    byLocation.set(key, ids)
  }

  const uniquePairs = [...byLocation.entries()]

  await report(context, `[geocode] ${listings.length} listing(s) → ${uniquePairs.length} unique location(s) to look up`, {
    stage: 'geocoding',
    current: 0,
    total: uniquePairs.length,
  })

  let successListings = 0
  let failedListings = 0
  let skippedListings = 0

  for (let i = 0; i < uniquePairs.length; i++) {
    const [key, ids] = uniquePairs[i]!
    const [city, state] = key.split('|') as [string, string]

    // Acquire locks on all listings in this location group before geocoding.
    // Skip any listing that is actively locked by another job.
    // Locks are held during the Nominatim HTTP call and released immediately after;
    // the subsequent sleep does NOT hold the lock.
    const lockedIds: string[] = []
    for (const id of ids) {
      const acquired = await acquireListingLock(db, id)
      if (acquired) {
        lockedIds.push(id)
      } else {
        skippedListings++
      }
    }

    if (lockedIds.length === 0) {
      await report(
        context,
        `[geocode] ${i + 1}/${uniquePairs.length} locations — ${city}, ${state}: all ${ids.length} listing(s) locked, skipping`,
        { stage: 'geocoding', current: i + 1, total: uniquePairs.length },
      )
      if (i < uniquePairs.length - 1) await jitteredSleep(RATE_LIMIT_MS)
      continue
    }

    const coords = await geocode(city, state)

    try {
      if (coords) {
        await db.listing.updateMany({
          where: { id: { in: lockedIds } },
          data: { lat: coords.lat, lng: coords.lng },
        })
        successListings += lockedIds.length
      } else {
        failedListings += lockedIds.length
      }
    } finally {
      await releaseListingLocks(db, lockedIds)
    }

    await report(
      context,
      `[geocode] ${i + 1}/${uniquePairs.length} locations — ${city}, ${state} → ${coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'not found'} (${lockedIds.length} listing(s)${ids.length !== lockedIds.length ? `, ${ids.length - lockedIds.length} skipped/locked` : ''})`,
      { stage: 'geocoding', current: i + 1, total: uniquePairs.length },
    )

    if (i < uniquePairs.length - 1) {
      await jitteredSleep(RATE_LIMIT_MS)
    }
  }

  // The coordinates are committed to Postgres above (Prisma updateMany, which
  // advances `updatedAt`). Search-index sync is no longer this job's concern:
  // the single-owner indexer poller (#669) picks up any touched listing on
  // its next tick, so there is nothing further to do or defer here.
  await report(context, `[geocode] Done. ${successListings} geocoded, ${failedListings} failed, ${skippedListings} skipped (locked).`, {
    stage: 'complete',
    current: uniquePairs.length,
    total: uniquePairs.length,
  })
  // #969: unlike apps/scraper (a dedicated, single-purpose process), the
  // `getDb()` client here is a long-lived singleton apps/api's index.ts also
  // hands to every HTTP route handler and only disconnects on graceful
  // shutdown — a per-job `$disconnect()` would tear that shared client down
  // (and force a reconnect) while concurrent API traffic may be using it, so
  // apps/api's copies of these jobs omit it.
}
