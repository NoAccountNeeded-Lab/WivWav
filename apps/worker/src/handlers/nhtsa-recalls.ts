import { report, jitteredSleep } from '@wivwav/scraper-sources'
import type { WivWavLogger } from '@wivwav/logger'
import {
  nhtsaRecallsJobPayloadSchema,
  type NhtsaRecallsJobResult,
} from '@wivwav/types/http-enrich-gateway'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createJobContext } from '../job-context.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'
import { parseNhtsaDMY } from '../lib/nhtsa-date-utils.js'

const RECALLS_URL = 'https://api.nhtsa.gov/recalls/recallsByVehicle'
const RATE_LIMIT_MS = 300

interface NhtsaRecall {
  NHTSACampaignNumber: string
  Component: string
  Summary: string
  Remedy?: string | null
  ReportReceivedDate?: string | null
}

interface RecallsResponse {
  results?: NhtsaRecall[]
}

async function fetchRecalls(make: string, model: string, year: number): Promise<NhtsaRecall[]> {
  const params = new URLSearchParams({ make, model, modelYear: String(year) })
  let res: Response
  try {
    res = await fetchWithRetry(`${RECALLS_URL}?${params}`, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
    })
  } catch {
    return []
  }
  const data: RecallsResponse = await res.json()
  return data.results ?? []
}

/**
 * NHTSA_RECALLS handler (#963): ported from
 * `apps/scraper/src/jobs/nhtsa-recalls.ts`. The vehicle-model read and the
 * recall upsert both cross the `http-enrich` gateway instead of Prisma — see
 * `HttpEnrichGatewayClient` and `packages/types/src/http-enrich-gateway.ts`.
 */
export function createNhtsaRecallsHandler(gateway: HttpEnrichGatewayClient, logger: WivWavLogger) {
  return async (payload: unknown, correlationId: string): Promise<NhtsaRecallsJobResult> => {
    const data = nhtsaRecallsJobPayloadSchema.parse(payload ?? {})
    const context = createJobContext(logger, correlationId)

    const { vehicleModels } = await gateway.listVehicleModels(data.vehicleModelId)

    await report(context, `[nhtsa-recalls] ${vehicleModels.length} vehicle model(s) to refresh`, {
      stage: 'fetching',
      current: 0,
      total: vehicleModels.length,
    })

    let processed = 0

    for (let i = 0; i < vehicleModels.length; i++) {
      const vm = vehicleModels[i]!
      const recalls = await fetchRecalls(vm.make, vm.model, vm.year)

      for (const recall of recalls) {
        if (!recall.NHTSACampaignNumber) continue

        await gateway.upsertRecall({
          vehicleModelId: vm.id,
          nhtsaCampaignId: recall.NHTSACampaignNumber,
          component: recall.Component,
          summary: recall.Summary,
          remedy: recall.Remedy ?? null,
          reportedAt: parseNhtsaDMY(recall.ReportReceivedDate),
        })
        processed++
      }

      await report(
        context,
        `[nhtsa-recalls] ${i + 1}/${vehicleModels.length} — ${vm.year} ${vm.make} ${vm.model}: ${recalls.length} recall(s)`,
        { stage: 'fetching', current: i + 1, total: vehicleModels.length },
      )

      if (i < vehicleModels.length - 1) await jitteredSleep(RATE_LIMIT_MS)
    }

    await report(context, `[nhtsa-recalls] Done. ${processed} recall(s) upserted across ${vehicleModels.length} model(s).`, {
      stage: 'complete',
      current: vehicleModels.length,
      total: vehicleModels.length,
    })

    return { processed }
  }
}
