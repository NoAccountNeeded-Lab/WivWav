import { report, jitteredSleep } from '@wivwav/scraper-sources'
import type { WivWavLogger } from '@wivwav/logger'
import {
  nhtsaComplaintsJobPayloadSchema,
  type NhtsaComplaintsJobResult,
} from '@wivwav/types/http-enrich-gateway'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createJobContext } from '../job-context.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'

const COMPLAINTS_URL = 'https://api.nhtsa.gov/complaints/complaintsByVehicle'
const RATE_LIMIT_MS = 300

interface NhtsaComplaint {
  odiNumber: number
  components?: string | null
  summary?: string | null
  mileage?: number | null
  crash?: boolean | null
  // NHTSA returns dateOfIncident as YYYYMMDD integer
  dateOfIncident?: number | null
}

interface ComplaintsResponse {
  results?: NhtsaComplaint[]
}

function parseYMD(val: number | null | undefined): Date {
  if (!val) return new Date(0)
  const s = String(val)
  if (s.length !== 8) return new Date(0)
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
}

async function fetchComplaints(make: string, model: string, year: number): Promise<NhtsaComplaint[]> {
  const params = new URLSearchParams({ make, model, modelYear: String(year) })
  let res: Response
  try {
    res = await fetchWithRetry(`${COMPLAINTS_URL}?${params}`, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
    })
  } catch {
    return []
  }
  const data: ComplaintsResponse = await res.json()
  return data.results ?? []
}

/**
 * NHTSA_COMPLAINTS handler (#963): ported from
 * `apps/scraper/src/jobs/nhtsa-complaints.ts` onto the `http-enrich` gateway.
 */
export function createNhtsaComplaintsHandler(gateway: HttpEnrichGatewayClient, logger: WivWavLogger) {
  return async (payload: unknown, correlationId: string): Promise<NhtsaComplaintsJobResult> => {
    const data = nhtsaComplaintsJobPayloadSchema.parse(payload ?? {})
    const context = createJobContext(logger, correlationId)

    const { vehicleModels } = await gateway.listVehicleModels(data.vehicleModelId)

    await report(context, `[nhtsa-complaints] ${vehicleModels.length} vehicle model(s) to refresh`, {
      stage: 'fetching',
      current: 0,
      total: vehicleModels.length,
    })

    let processed = 0

    for (let i = 0; i < vehicleModels.length; i++) {
      const vm = vehicleModels[i]!
      const complaints = await fetchComplaints(vm.make, vm.model, vm.year)

      for (const c of complaints) {
        if (!c.odiNumber) continue

        await gateway.upsertComplaint({
          vehicleModelId: vm.id,
          nhtsaId: String(c.odiNumber),
          component: c.components ?? 'Unknown',
          summary: c.summary ?? '',
          mileage: c.mileage ?? null,
          crashInvolved: c.crash ?? false,
          reportedAt: parseYMD(c.dateOfIncident),
        })
        processed++
      }

      await report(
        context,
        `[nhtsa-complaints] ${i + 1}/${vehicleModels.length} — ${vm.year} ${vm.make} ${vm.model}: ${complaints.length} complaint(s)`,
        { stage: 'fetching', current: i + 1, total: vehicleModels.length },
      )

      if (i < vehicleModels.length - 1) await jitteredSleep(RATE_LIMIT_MS)
    }

    await report(
      context,
      `[nhtsa-complaints] Done. ${processed} complaint(s) upserted across ${vehicleModels.length} model(s).`,
      { stage: 'complete', current: vehicleModels.length, total: vehicleModels.length },
    )

    return { processed }
  }
}
