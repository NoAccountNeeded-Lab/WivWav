import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'
import { parseNhtsaDMY } from './nhtsa-date-utils.js'

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

export interface NhtsaRecallsJobData {
  vehicleModelId?: string
}

export async function runNhtsaRecallsJob(context?: JobContext, data?: NhtsaRecallsJobData): Promise<void> {
  const db = getDb()

  const models = await db.vehicleModel.findMany({
    ...(data?.vehicleModelId ? { where: { id: data.vehicleModelId } } : {}),
    select: { id: true, make: true, model: true, year: true },
  })

  await report(context, `[nhtsa-recalls] ${models.length} vehicle model(s) to refresh`, {
    stage: 'fetching',
    current: 0,
    total: models.length,
  })

  let upserted = 0

  for (let i = 0; i < models.length; i++) {
    const vm = models[i]!
    const recalls = await fetchRecalls(vm.make, vm.model, vm.year)

    for (const recall of recalls) {
      if (!recall.NHTSACampaignNumber) continue

      await db.recall.upsert({
        where: {
          nhtsaCampaignId_vehicleModelId: {
            nhtsaCampaignId: recall.NHTSACampaignNumber,
            vehicleModelId: vm.id,
          },
        },
        update: {
          component: recall.Component,
          summary: recall.Summary,
          remedy: recall.Remedy ?? null,
          reportedAt: parseNhtsaDMY(recall.ReportReceivedDate),
          refreshedAt: new Date(),
        },
        create: {
          nhtsaCampaignId: recall.NHTSACampaignNumber,
          vehicleModelId: vm.id,
          component: recall.Component,
          summary: recall.Summary,
          remedy: recall.Remedy ?? null,
          reportedAt: parseNhtsaDMY(recall.ReportReceivedDate),
          refreshedAt: new Date(),
        },
      })
      upserted++
    }

    await report(
      context,
      `[nhtsa-recalls] ${i + 1}/${models.length} — ${vm.year} ${vm.make} ${vm.model}: ${recalls.length} recall(s)`,
      { stage: 'fetching', current: i + 1, total: models.length },
    )

    if (i < models.length - 1) await jitteredSleep(RATE_LIMIT_MS)
  }

  await report(context, `[nhtsa-recalls] Done. ${upserted} recall(s) upserted across ${models.length} model(s).`, {
    stage: 'complete',
    current: models.length,
    total: models.length,
  })
  await db.$disconnect()
}
