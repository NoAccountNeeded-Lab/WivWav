import { report, jitteredSleep } from '@wivwav/scraper-sources'
import type { WivWavLogger } from '@wivwav/logger'
import {
  nhtsaManufacturerCommunicationsJobPayloadSchema,
  type NhtsaManufacturerCommunicationsJobResult,
} from '@wivwav/types/http-enrich-gateway'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createJobContext } from '../job-context.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'
import { parseNhtsaYMD } from '../lib/nhtsa-date-utils.js'

// NHTSA Technical Service Bulletins (TSBs) are the primary manufacturer
// communication artifact exposed by the public NHTSA API.
const TSBS_URL = 'https://api.nhtsa.gov/tsbs/tsbsByVehicle'
const TSB_SOURCE_BASE = 'https://www.nhtsa.gov/vehicle/safety-issues/tsbs'
const RATE_LIMIT_MS = 300

interface NhtsaTsb {
  tsbId: string
  component?: string | null
  summary?: string | null
  issuedDate?: string | null
}

interface TsbsResponse {
  results?: NhtsaTsb[]
}

async function fetchTsbs(make: string, model: string, year: number): Promise<NhtsaTsb[]> {
  const params = new URLSearchParams({ make, model, modelYear: String(year) })
  try {
    const res = await fetchWithRetry(`${TSBS_URL}?${params}`, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data: TsbsResponse = await res.json()
    return data.results ?? []
  } catch {
    return []
  }
}

/**
 * NHTSA_MANUFACTURER_COMMUNICATIONS handler (#963): ported from
 * `apps/scraper/src/jobs/nhtsa-manufacturer-communications.ts` onto the
 * `http-enrich` gateway.
 */
export function createNhtsaManufacturerCommunicationsHandler(
  gateway: HttpEnrichGatewayClient,
  logger: WivWavLogger,
) {
  return async (payload: unknown, correlationId: string): Promise<NhtsaManufacturerCommunicationsJobResult> => {
    const data = nhtsaManufacturerCommunicationsJobPayloadSchema.parse(payload ?? {})
    const context = createJobContext(logger, correlationId)

    const { vehicleModels } = await gateway.listVehicleModels(data.vehicleModelId)

    await report(context, `[nhtsa-manufacturer-comms] ${vehicleModels.length} vehicle model(s) to refresh`, {
      stage: 'fetching',
      current: 0,
      total: vehicleModels.length,
    })

    let processed = 0

    for (let i = 0; i < vehicleModels.length; i++) {
      const vm = vehicleModels[i]!
      const tsbs = await fetchTsbs(vm.make, vm.model, vm.year)

      for (const tsb of tsbs) {
        if (!tsb.tsbId) continue

        const sourceUrl = `${TSB_SOURCE_BASE}?tsbId=${encodeURIComponent(tsb.tsbId)}`

        await gateway.upsertManufacturerCommunication({
          vehicleModelId: vm.id,
          nhtsaId: tsb.tsbId,
          component: tsb.component ?? 'Unknown',
          summary: tsb.summary ?? '',
          issuedDate: parseNhtsaYMD(tsb.issuedDate),
          sourceUrl,
        })
        processed++
      }

      await report(
        context,
        `[nhtsa-manufacturer-comms] ${i + 1}/${vehicleModels.length} — ${vm.year} ${vm.make} ${vm.model}: ${tsbs.length} TSB(s)`,
        { stage: 'fetching', current: i + 1, total: vehicleModels.length },
      )

      if (i < vehicleModels.length - 1) await jitteredSleep(RATE_LIMIT_MS)
    }

    await report(
      context,
      `[nhtsa-manufacturer-comms] Done. ${processed} TSB(s) upserted across ${vehicleModels.length} model(s).`,
      { stage: 'complete', current: vehicleModels.length, total: vehicleModels.length },
    )

    return { processed }
  }
}
