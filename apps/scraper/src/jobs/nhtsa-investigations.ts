import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'
import { parseNhtsaYMD } from './nhtsa-date-utils.js'

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchInvestigations(make: string, model: string, year: number): Promise<NhtsaInvestigation[]> {
  const params = new URLSearchParams({ make, model, modelYear: String(year) })
  try {
    const res = await fetch(`${INVESTIGATIONS_URL}?${params}`, {
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

export interface NhtsaInvestigationsJobData {
  vehicleModelId?: string
}

export async function runNhtsaInvestigationsJob(context?: JobContext, data?: NhtsaInvestigationsJobData): Promise<void> {
  const db = getDb()

  const models = await db.vehicleModel.findMany({
    ...(data?.vehicleModelId ? { where: { id: data.vehicleModelId } } : {}),
    select: { id: true, make: true, model: true, year: true },
  })

  await report(context, `[nhtsa-investigations] ${models.length} vehicle model(s) to refresh`, {
    stage: 'fetching',
    current: 0,
    total: models.length,
  })

  let upserted = 0

  for (let i = 0; i < models.length; i++) {
    const vm = models[i]!
    const investigations = await fetchInvestigations(vm.make, vm.model, vm.year)

    for (const inv of investigations) {
      if (!inv.investigationId) continue

      const sourceUrl = `${INVESTIGATIONS_SOURCE_BASE}&investigationId=${encodeURIComponent(inv.investigationId)}`

      await db.investigation.upsert({
        where: { nhtsaId: inv.investigationId },
        update: {
          vehicleModelId: vm.id,
          component: inv.component ?? 'Unknown',
          summary: inv.summary ?? '',
          openedDate: parseNhtsaYMD(inv.openedDate),
          closedDate: inv.closedDate ? parseNhtsaYMD(inv.closedDate) : null,
          outcome: inv.outcome ?? null,
          sourceUrl,
          refreshedAt: new Date(),
        },
        create: {
          nhtsaId: inv.investigationId,
          vehicleModelId: vm.id,
          component: inv.component ?? 'Unknown',
          summary: inv.summary ?? '',
          openedDate: parseNhtsaYMD(inv.openedDate),
          closedDate: inv.closedDate ? parseNhtsaYMD(inv.closedDate) : null,
          outcome: inv.outcome ?? null,
          sourceUrl,
        },
      })
      upserted++
    }

    await report(
      context,
      `[nhtsa-investigations] ${i + 1}/${models.length} — ${vm.year} ${vm.make} ${vm.model}: ${investigations.length} investigation(s)`,
      { stage: 'fetching', current: i + 1, total: models.length },
    )

    if (i < models.length - 1) await sleep(RATE_LIMIT_MS)
  }

  await report(context, `[nhtsa-investigations] Done. ${upserted} investigation(s) upserted across ${models.length} model(s).`, {
    stage: 'complete',
    current: models.length,
    total: models.length,
  })
  await db.$disconnect()
}
