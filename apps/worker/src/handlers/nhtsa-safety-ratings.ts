import { report, jitteredSleep } from '@wivwav/scraper-sources'
import type { WivWavLogger } from '@wivwav/logger'
import {
  nhtsaSafetyRatingsJobPayloadSchema,
  type NhtsaSafetyRatingsJobResult,
} from '@wivwav/types/http-enrich-gateway'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createJobContext } from '../job-context.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'

const RATINGS_BASE = 'https://api.nhtsa.gov/SafetyRatings'
const RATE_LIMIT_MS = 300

interface RatingsVariant {
  VehicleId: number
  VehicleDescription?: string
}

interface RatingsVariantsResponse {
  Results?: RatingsVariant[]
}

interface RatingsDetail {
  VehicleId: number
  VehicleDescription?: string
  OverallRating?: string
  OverallFrontCrashRating?: string
  OverallSideCrashRating?: string
  RolloverRating?: string
  RolloverRating2?: string
}

interface RatingsDetailResponse {
  Results?: RatingsDetail[]
}

function parseStar(val: string | null | undefined): number | null {
  if (!val) return null
  const n = parseInt(val)
  return isNaN(n) ? null : n
}

async function fetchVariants(make: string, model: string, year: number): Promise<RatingsVariant[]> {
  let res: Response
  try {
    res = await fetchWithRetry(
      `${RATINGS_BASE}/modelyear/${year}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`,
      { headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' } },
    )
  } catch {
    return []
  }
  const data: RatingsVariantsResponse = await res.json()
  return data.Results ?? []
}

async function fetchRatings(vehicleId: number): Promise<RatingsDetail | null> {
  let res: Response
  try {
    res = await fetchWithRetry(`${RATINGS_BASE}/VehicleId/${vehicleId}`, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
    })
  } catch {
    return null
  }
  const data: RatingsDetailResponse = await res.json()
  return data.Results?.[0] ?? null
}

/**
 * NHTSA_SAFETY_RATINGS handler (#963): ported from
 * `apps/scraper/src/jobs/nhtsa-safety-ratings.ts` onto the `http-enrich` gateway.
 */
export function createNhtsaSafetyRatingsHandler(gateway: HttpEnrichGatewayClient, logger: WivWavLogger) {
  return async (payload: unknown, correlationId: string): Promise<NhtsaSafetyRatingsJobResult> => {
    const data = nhtsaSafetyRatingsJobPayloadSchema.parse(payload ?? {})
    const context = createJobContext(logger, correlationId)

    const { vehicleModels } = await gateway.listVehicleModels(data.vehicleModelId)

    await report(context, `[nhtsa-safety-ratings] ${vehicleModels.length} vehicle model(s) to refresh`, {
      stage: 'fetching',
      current: 0,
      total: vehicleModels.length,
    })

    let processed = 0

    for (let i = 0; i < vehicleModels.length; i++) {
      const vm = vehicleModels[i]!
      const variants = await fetchVariants(vm.make, vm.model, vm.year)

      for (const variant of variants) {
        await jitteredSleep(RATE_LIMIT_MS)
        const detail = await fetchRatings(variant.VehicleId)
        if (!detail) continue

        await gateway.upsertSafetyRating({
          vehicleModelId: vm.id,
          nhtsaVehicleId: variant.VehicleId,
          description: detail.VehicleDescription ?? variant.VehicleDescription ?? null,
          overallRating: parseStar(detail.OverallRating),
          frontCrashRating: parseStar(detail.OverallFrontCrashRating),
          sideCrashRating: parseStar(detail.OverallSideCrashRating),
          rolloverRating: parseStar(detail.RolloverRating),
          rolloverRatingText: detail.RolloverRating2 ?? null,
        })
        processed++
      }

      await report(
        context,
        `[nhtsa-safety-ratings] ${i + 1}/${vehicleModels.length} — ${vm.year} ${vm.make} ${vm.model}: ${variants.length} variant(s)`,
        { stage: 'fetching', current: i + 1, total: vehicleModels.length },
      )

      if (i < vehicleModels.length - 1) await jitteredSleep(RATE_LIMIT_MS)
    }

    await report(
      context,
      `[nhtsa-safety-ratings] Done. ${processed} rating(s) upserted across ${vehicleModels.length} model(s).`,
      { stage: 'complete', current: vehicleModels.length, total: vehicleModels.length },
    )

    return { processed }
  }
}
