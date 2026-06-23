import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'
import { parseNhtsaYMD } from './nhtsa-date-utils.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'

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

export interface NhtsaManufacturerCommunicationsJobData {
  vehicleModelId?: string
}

export async function runNhtsaManufacturerCommunicationsJob(
  context?: JobContext,
  data?: NhtsaManufacturerCommunicationsJobData,
): Promise<void> {
  const db = getDb()

  const models = await db.vehicleModel.findMany({
    ...(data?.vehicleModelId ? { where: { id: data.vehicleModelId } } : {}),
    select: { id: true, make: true, model: true, year: true },
  })

  await report(context, `[nhtsa-manufacturer-comms] ${models.length} vehicle model(s) to refresh`, {
    stage: 'fetching',
    current: 0,
    total: models.length,
  })

  let upserted = 0

  for (let i = 0; i < models.length; i++) {
    const vm = models[i]!
    const tsbs = await fetchTsbs(vm.make, vm.model, vm.year)

    for (const tsb of tsbs) {
      if (!tsb.tsbId) continue

      const sourceUrl = `${TSB_SOURCE_BASE}?tsbId=${encodeURIComponent(tsb.tsbId)}`

      await db.manufacturerCommunication.upsert({
        where: { nhtsaId: tsb.tsbId },
        update: {
          vehicleModelId: vm.id,
          component: tsb.component ?? 'Unknown',
          summary: tsb.summary ?? '',
          issuedDate: parseNhtsaYMD(tsb.issuedDate),
          sourceUrl,
          refreshedAt: new Date(),
        },
        create: {
          nhtsaId: tsb.tsbId,
          vehicleModelId: vm.id,
          component: tsb.component ?? 'Unknown',
          summary: tsb.summary ?? '',
          issuedDate: parseNhtsaYMD(tsb.issuedDate),
          sourceUrl,
        },
      })
      upserted++
    }

    await report(
      context,
      `[nhtsa-manufacturer-comms] ${i + 1}/${models.length} — ${vm.year} ${vm.make} ${vm.model}: ${tsbs.length} TSB(s)`,
      { stage: 'fetching', current: i + 1, total: models.length },
    )

    if (i < models.length - 1) await jitteredSleep(RATE_LIMIT_MS)
  }

  await report(
    context,
    `[nhtsa-manufacturer-comms] Done. ${upserted} TSB(s) upserted across ${models.length} model(s).`,
    { stage: 'complete', current: models.length, total: models.length },
  )
  await db.$disconnect()
}
