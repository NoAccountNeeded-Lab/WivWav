import { report, jitteredSleep } from '@wivwav/scraper-sources'
import type { WivWavLogger } from '@wivwav/logger'
import {
  dealerEnrichJobPayloadSchema,
  type DealerEnrichJobResult,
} from '@wivwav/types/http-enrich-gateway'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createJobContext } from '../job-context.js'
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

// Minimum gap between API calls to stay within rate limits.
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

async function findPlaceId(dealerName: string, zip: string, apiKey: string): Promise<string | null> {
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

async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<PlaceDetailsResult | null> {
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

/**
 * DEALER_ENRICH handler (#963): ported from
 * `apps/scraper/src/jobs/dealer-enrich.ts` onto the `http-enrich` gateway.
 * The dealer-candidate scan, DealerProfile/DealerReview upserts, and the
 * listing → dealerProfile link all move server-side into
 * `/dealer-enrich/pending` and `/dealer-enrich/submit` — this handler keeps
 * only the two Google Places calls (which need `GOOGLE_PLACES_API_KEY` from
 * this worker process's own environment, same as the original job).
 */
export function createDealerEnrichHandler(gateway: HttpEnrichGatewayClient, logger: WivWavLogger) {
  return async (payload: unknown, correlationId: string): Promise<DealerEnrichJobResult> => {
    dealerEnrichJobPayloadSchema.parse(payload ?? {})
    const context = createJobContext(logger, correlationId)

    const apiKey = process.env['GOOGLE_PLACES_API_KEY']
    if (!apiKey) {
      await report(context, '[dealer-enrich] GOOGLE_PLACES_API_KEY not set — skipping', {
        stage: 'complete',
        current: 0,
        total: 0,
      })
      return { processed: 0 }
    }

    const staleThreshold = new Date(Date.now() - ENRICH_STALE_DAYS * 24 * 60 * 60 * 1000)
    const { dealers: toEnrich } = await gateway.listDealerEnrichPending(MAX_DEALERS_PER_RUN, staleThreshold)

    await report(context, `[dealer-enrich] ${toEnrich.length} dealer(s) to enrich`, {
      stage: 'enriching',
      current: 0,
      total: toEnrich.length,
    })

    let processed = 0
    let failed = 0

    for (let i = 0; i < toEnrich.length; i++) {
      const { dealerName, zip } = toEnrich[i]!

      try {
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

        const details = await fetchPlaceDetails(placeId, apiKey)
        await jitteredSleep(RATE_LIMIT_MS)

        const rawReviews = details?.reviews ?? []
        const topReviews = [...rawReviews].sort((a, b) => b.rating - a.rating).slice(0, MAX_REVIEWS)

        await gateway.submitDealerEnrich({
          dealerName,
          zip,
          googlePlaceId: placeId,
          rating: details?.rating ?? null,
          reviewCount: details?.user_ratings_total ?? null,
          hours: details?.opening_hours ?? null,
          reviews: topReviews.map((review) => ({
            authorName: review.author_name,
            rating: review.rating,
            text: review.text,
            publishedAt: new Date(review.time * 1000),
          })),
        })

        processed++
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

    await report(context, `[dealer-enrich] Done. ${processed} enriched, ${failed} failed.`, {
      stage: 'complete',
      current: toEnrich.length,
      total: toEnrich.length,
    })

    return { processed }
  }
}
