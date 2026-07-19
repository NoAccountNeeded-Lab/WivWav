import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
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

export interface NhtsaComplaintsJobData {
  vehicleModelId?: string
}

export async function runNhtsaComplaintsJob(context?: JobContext, data?: NhtsaComplaintsJobData): Promise<void> {
  const db = getDb()

  const models = await db.vehicleModel.findMany({
    ...(data?.vehicleModelId ? { where: { id: data.vehicleModelId } } : {}),
    select: { id: true, make: true, model: true, year: true },
  })

  await report(context, `[nhtsa-complaints] ${models.length} vehicle model(s) to refresh`, {
    stage: 'fetching',
    current: 0,
    total: models.length,
  })

  let upserted = 0

  for (let i = 0; i < models.length; i++) {
    const vm = models[i]!
    const complaints = await fetchComplaints(vm.make, vm.model, vm.year)

    for (const c of complaints) {
      if (!c.odiNumber) continue
      const nhtsaId = String(c.odiNumber)

      await db.complaint.upsert({
        where: { nhtsaId },
        update: {
          vehicleModelId: vm.id,
          component: c.components ?? 'Unknown',
          summary: c.summary ?? '',
          mileage: c.mileage ?? null,
          crashInvolved: c.crash ?? false,
          reportedAt: parseYMD(c.dateOfIncident),
          refreshedAt: new Date(),
        },
        create: {
          nhtsaId,
          vehicleModelId: vm.id,
          component: c.components ?? 'Unknown',
          summary: c.summary ?? '',
          mileage: c.mileage ?? null,
          crashInvolved: c.crash ?? false,
          reportedAt: parseYMD(c.dateOfIncident),
          refreshedAt: new Date(),
        },
      })
      upserted++
    }

    await report(
      context,
      `[nhtsa-complaints] ${i + 1}/${models.length} — ${vm.year} ${vm.make} ${vm.model}: ${complaints.length} complaint(s)`,
      { stage: 'fetching', current: i + 1, total: models.length },
    )

    if (i < models.length - 1) await jitteredSleep(RATE_LIMIT_MS)
  }

  await report(context, `[nhtsa-complaints] Done. ${upserted} complaint(s) upserted across ${models.length} model(s).`, {
    stage: 'complete',
    current: models.length,
    total: models.length,
  })
  await db.$disconnect()
}
