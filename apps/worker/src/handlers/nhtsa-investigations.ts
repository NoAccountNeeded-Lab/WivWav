import { report, jitteredSleep } from '@wivwav/scraper-sources'
import type { WivWavLogger } from '@wivwav/logger'
import {
  nhtsaInvestigationsJobPayloadSchema,
  type NhtsaInvestigationsJobResult,
} from '@wivwav/types/http-enrich-gateway'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createJobContext } from '../job-context.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'
import { parseNhtsaYMD } from '../lib/nhtsa-date-utils.js'

const INVESTIGATIONS_URL = 'https://api.nhtsa.gov/investigations/investigationsByVehicle'
const INVESTIGATIONS_SOURCE_BASE = 'https://www.nhtsa.gov/vehicle-safety/recalls-and-investigations#investigations'
const RATE_LIMIT_MS = 300

interface NhtsaInvestigation {
  investigationId: string
  component?: string | null
  summary?: string | null
  openedDate?: string | null
  closedDate?: string | null
  outcome?: string | null
}

interface InvestigationsResponse {
  results?: NhtsaInvestigation[]
}

async function fetchInvestigations(make: string, model: string, year: number): Promise<NhtsaInvestigation[]> {
  const params = new URLSearchParams({ make, model, modelYear: String(year) })
  try {
    const res = await fetchWithRetry(`${INVESTIGATIONS_URL}?${params}`, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data: InvestigationsResponse = await res.json()
    return data.results ?? []
  } catch {
    return []
  }
}

/**
 * NHTSA_INVESTIGATIONS handler (#963): ported from
 * `apps/scraper/src/jobs/nhtsa-investigations.ts` onto the `http-enrich` gateway.
 */
export function createNhtsaInvestigationsHandler(gateway: HttpEnrichGatewayClient, logger: WivWavLogger) {
  return async (payload: unknown, correlationId: string): Promise<NhtsaInvestigationsJobResult> => {
    const data = nhtsaInvestigationsJobPayloadSchema.parse(payload ?? {})
    const context = createJobContext(logger, correlationId)

    const { vehicleModels } = await gateway.listVehicleModels(data.vehicleModelId)

    await report(context, `[nhtsa-investigations] ${vehicleModels.length} vehicle model(s) to refresh`, {
      stage: 'fetching',
      current: 0,
      total: vehicleModels.length,
    })

    let processed = 0

    for (let i = 0; i < vehicleModels.length; i++) {
      const vm = vehicleModels[i]!
      const investigations = await fetchInvestigations(vm.make, vm.model, vm.year)

      for (const inv of investigations) {
        if (!inv.investigationId) continue

        const sourceUrl = `${INVESTIGATIONS_SOURCE_BASE}&investigationId=${encodeURIComponent(inv.investigationId)}`

        await gateway.upsertInvestigation({
          vehicleModelId: vm.id,
          nhtsaId: inv.investigationId,
          component: inv.component ?? 'Unknown',
          summary: inv.summary ?? '',
          openedDate: parseNhtsaYMD(inv.openedDate),
          closedDate: inv.closedDate ? parseNhtsaYMD(inv.closedDate) : null,
          outcome: inv.outcome ?? null,
          sourceUrl,
        })
        processed++
      }

      await report(
        context,
        `[nhtsa-investigations] ${i + 1}/${vehicleModels.length} — ${vm.year} ${vm.make} ${vm.model}: ${investigations.length} investigation(s)`,
        { stage: 'fetching', current: i + 1, total: vehicleModels.length },
      )

      if (i < vehicleModels.length - 1) await jitteredSleep(RATE_LIMIT_MS)
    }

    await report(
      context,
      `[nhtsa-investigations] Done. ${processed} investigation(s) upserted across ${vehicleModels.length} model(s).`,
      { stage: 'complete', current: vehicleModels.length, total: vehicleModels.length },
    )

    return { processed }
  }
}
