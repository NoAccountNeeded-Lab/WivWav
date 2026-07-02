import { getDb } from '@wivwav/db'
import type { JobContext, QueueAdapter } from '@wivwav/queue'
import { CRITICAL_JOB_OPTIONS, LISTING_SYNC_REBUILD_JOB_ID } from '@wivwav/queue'
import { syncListings } from '@wivwav/search'
import { getMeiliClient } from '../lib/meili.js'
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

  const results: NominatimResult[] = await res.json()
  if (results.length === 0) return null

  return { lat: parseFloat(results[0]!.lat), lng: parseFloat(results[0]!.lon) }
}


export async function runGeocodeJob(context?: JobContext, listingSyncQueue?: QueueAdapter): Promise<void> {
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
  const syncedIds: string[] = []

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
        syncedIds.push(...lockedIds)
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

  // The coordinates are already committed to Postgres above. The Meilisearch
  // sync is a downstream reconciliation step — if it fails (Meili offline,
  // missing auth, transient network), the geocoding work must NOT be lost and
  // the job must NOT be marked failed (that fires a false "map pins may be
  // incomplete" critical alert). Treat a sync failure as non-fatal and hand the
  // reconciliation off to the dedicated listing-sync queue, which retries with
  // backoff and runs nightly anyway.
  let syncedToMeili = false
  if (syncedIds.length > 0) {
    try {
      await syncListings(syncedIds, db, getMeiliClient())
      syncedToMeili = true
    } catch (syncErr) {
      context?.logger?.error({ err: syncErr, count: syncedIds.length }, '[geocode] Meilisearch sync failed — coordinates saved, deferring to listing-sync queue')
      await report(context, `[geocode] Meilisearch sync failed (${syncedIds.length} listing(s) saved but not yet indexed): ${syncErr}`)
      if (listingSyncQueue !== undefined) {
        try {
          await listingSyncQueue.add({}, { ...CRITICAL_JOB_OPTIONS, jobId: LISTING_SYNC_REBUILD_JOB_ID })
        } catch (enqueueErr) {
          context?.logger?.error({ err: enqueueErr }, '[geocode] Failed to enqueue listing-sync job')
          await report(context, `[geocode] Failed to enqueue listing-sync job: ${enqueueErr}`)
        }
      }
    }
  }

  await report(context, `[geocode] Done. ${successListings} geocoded, ${failedListings} failed, ${skippedListings} skipped (locked). ${syncedToMeili ? `${syncedIds.length} listing(s) synced to Meilisearch.` : `${syncedIds.length} listing(s) saved; Meilisearch sync deferred.`}`, {
    stage: 'complete',
    current: uniquePairs.length,
    total: uniquePairs.length,
  })
  await db.$disconnect()
}
