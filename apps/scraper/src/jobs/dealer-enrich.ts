import { getDb } from '@wivwav/db'
import type { Prisma } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'

const PLACES_TEXT_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json'
const PLACES_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json'

/** Max reviews to store per dealer. Top 5 by rating. */
const MAX_REVIEWS = 5

/** Re-enrich dealers older than this many days. */
const ENRICH_STALE_DAYS = 30

/** Max dealers to process per run (stays within 100 req/day free-tier budget).
 *  Each dealer costs 2 requests (text search + details). So 50 dealers = 100 requests. */
const MAX_DEALERS_PER_RUN = 50


// Minimum gap between API calls to stay within rate limits. At 50 dealers
// * 2 calls each = 100 calls, spread over a reasonable window.
const RATE_LIMIT_MS = 200

interface PlaceCandidate {
  place_id: string
}

interface PlaceTextSearchResponse {
  status: string
  candidates: PlaceCandidate[]
}

interface PlaceReview {
  author_name: string
  rating: number
  text: string
  time: number // Unix seconds
}

interface PlaceOpeningHours {
  weekday_text?: string[]
  periods?: Array<{
    open: { day: number; time: string }
    close?: { day: number; time: string }
  }>
}

interface PlaceDetailsResult {
  place_id?: string
  rating?: number
  user_ratings_total?: number
  reviews?: PlaceReview[]
  opening_hours?: PlaceOpeningHours
  website?: string
}

interface PlaceDetailsResponse {
  status: string
  result?: PlaceDetailsResult
}

async function findPlaceId(
  dealerName: string,
  zip: string,
  apiKey: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    input: `${dealerName} ${zip}`,
    inputtype: 'textquery',
    fields: 'place_id',
    key: apiKey,
  })

  let res: Response
  try {
    res = await fetchWithRetry(`${PLACES_TEXT_SEARCH_URL}?${params}`, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
    })
  } catch {
    return null
  }

  const data: PlaceTextSearchResponse = await res.json()

  if (data.status !== 'OK' || !data.candidates.length) return null

  return data.candidates[0]!.place_id
}

async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<PlaceDetailsResult | null> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'rating,user_ratings_total,reviews,opening_hours,website',
    key: apiKey,
  })

  let res: Response
  try {
    res = await fetchWithRetry(`${PLACES_DETAILS_URL}?${params}`, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
    })
  } catch {
    return null
  }

  const data: PlaceDetailsResponse = await res.json()

  if (data.status !== 'OK' || !data.result) return null

  return data.result
}

export async function runDealerEnrichJob(context?: JobContext): Promise<void> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY']

  if (!apiKey) {
    await report(context, '[dealer-enrich] GOOGLE_PLACES_API_KEY not set — skipping', {
      stage: 'complete',
      current: 0,
      total: 0,
    })
    return
  }

  const db = getDb()
  const staleThreshold = new Date(Date.now() - ENRICH_STALE_DAYS * 24 * 60 * 60 * 1000)

  // Unique dealer name+zip combos that need enrichment.
  // Strategy: fetch a bounded page of distinct dealers from listings, then
  // filter to those missing a profile or with a stale enrichedAt.
  // We fetch MAX_DEALERS_PER_RUN * 4 candidates at most so that stale
  // dealers are likely in scope without loading the entire dataset.
  const rawDealers = await db.listing.findMany({
    where: {
      dealerName: { not: null },
      zip: { not: null },
      sellerType: 'dealer',
    },
    select: { dealerName: true, zip: true },
    distinct: ['dealerName', 'zip'],
    take: MAX_DEALERS_PER_RUN * 4,
  })

  // Check which ones need enrichment (no profile or stale)
  const toEnrich: Array<{ dealerName: string; zip: string }> = []
  for (const row of rawDealers) {
    if (!row.dealerName || !row.zip) continue
    const existing = await db.dealerProfile.findUnique({
      where: { name_zip: { name: row.dealerName, zip: row.zip } },
      select: { id: true, enrichedAt: true },
    })
    if (!existing || !existing.enrichedAt || existing.enrichedAt < staleThreshold) {
      toEnrich.push({ dealerName: row.dealerName, zip: row.zip })
    }
    if (toEnrich.length >= MAX_DEALERS_PER_RUN) break
  }

  await report(
    context,
    `[dealer-enrich] ${toEnrich.length} dealer(s) to enrich (of ${rawDealers.length} unique)`,
    { stage: 'enriching', current: 0, total: toEnrich.length },
  )

  let enriched = 0
  let failed = 0

  for (let i = 0; i < toEnrich.length; i++) {
    const { dealerName, zip } = toEnrich[i]!

    try {
      // 1. Find the Place ID
      const placeId = await findPlaceId(dealerName, zip, apiKey)
      await jitteredSleep(RATE_LIMIT_MS)

      if (!placeId) {
        failed++
        await report(
          context,
          `[dealer-enrich] ${i + 1}/${toEnrich.length} — "${dealerName}" (${zip}): not found in Places`,
          { stage: 'enriching', current: i + 1, total: toEnrich.length },
        )
        continue
      }

      // 2. Fetch details
      const details = await fetchPlaceDetails(placeId, apiKey)
      await jitteredSleep(RATE_LIMIT_MS)

      // 3. Upsert DealerProfile
      // Prisma's Json? column requires InputJsonValue. With exactOptionalPropertyTypes
      // we cannot pass `| undefined` to a field typed as `InputJsonValue | NullableJsonNullValueInput`.
      // When hours is available we include it; when not, we omit the key entirely so Prisma
      // uses the column default (NULL on create) and leaves it unchanged on update.
      // `Prisma` is a type-only import so the cast has zero runtime cost.
      const openingHours = details?.opening_hours as Prisma.InputJsonValue | null | undefined
      const profile = openingHours
        ? await db.dealerProfile.upsert({
            where: { name_zip: { name: dealerName, zip } },
            create: { name: dealerName, zip, googlePlaceId: placeId, rating: details?.rating ?? null, reviewCount: details?.user_ratings_total ?? null, hours: openingHours, enrichedAt: new Date() },
            update: { googlePlaceId: placeId, rating: details?.rating ?? null, reviewCount: details?.user_ratings_total ?? null, hours: openingHours, enrichedAt: new Date() },
          })
        : await db.dealerProfile.upsert({
            where: { name_zip: { name: dealerName, zip } },
            create: { name: dealerName, zip, googlePlaceId: placeId, rating: details?.rating ?? null, reviewCount: details?.user_ratings_total ?? null, enrichedAt: new Date() },
            update: { googlePlaceId: placeId, rating: details?.rating ?? null, reviewCount: details?.user_ratings_total ?? null, enrichedAt: new Date() },
          })

      // 4. Upsert reviews (top MAX_REVIEWS by rating, deduped by source+publishedAt+authorName)
      const rawReviews = details?.reviews ?? []
      const topReviews = [...rawReviews]
        .sort((a, b) => b.rating - a.rating)
        .slice(0, MAX_REVIEWS)

      for (const review of topReviews) {
        const publishedAt = new Date(review.time * 1000)
        await db.dealerReview.upsert({
          where: {
            dealerId_source_publishedAt_authorName: {
              dealerId: profile.id,
              source: 'google',
              publishedAt,
              authorName: review.author_name,
            },
          },
          create: {
            dealerId: profile.id,
            authorName: review.author_name,
            rating: review.rating,
            text: review.text,
            publishedAt,
            source: 'google',
          },
          update: {
            rating: review.rating,
            text: review.text,
          },
        })
      }

      // 5. Link all listings for this dealer to the profile
      await db.listing.updateMany({
        where: { dealerName, zip },
        data: { dealerProfileId: profile.id },
      })

      enriched++
      await report(
        context,
        `[dealer-enrich] ${i + 1}/${toEnrich.length} — "${dealerName}" (${zip}): enriched (rating=${details?.rating ?? 'n/a'}, reviews=${topReviews.length})`,
        { stage: 'enriching', current: i + 1, total: toEnrich.length },
      )
    } catch (err) {
      failed++
      await report(
        context,
        `[dealer-enrich] ${i + 1}/${toEnrich.length} — "${dealerName}" (${zip}): error — ${err instanceof Error ? err.message : String(err)}`,
        { stage: 'enriching', current: i + 1, total: toEnrich.length },
      )
    }
  }

  await report(
    context,
    `[dealer-enrich] Done. ${enriched} enriched, ${failed} failed.`,
    { stage: 'complete', current: toEnrich.length, total: toEnrich.length },
  )
  await db.$disconnect()
}
