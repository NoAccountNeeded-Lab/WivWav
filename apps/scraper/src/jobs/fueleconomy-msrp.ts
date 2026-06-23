import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'

// Source: https://www.fueleconomy.gov/feg/ws/index.shtml#vehicle
// The fueleconomy.gov API is a U.S. Department of Energy public service with no
// authentication requirement. We apply a conservative 300 ms inter-request delay
// to be a polite client on shared government infrastructure.
const FUELECONOMY_BASE = 'https://www.fueleconomy.gov/ws/rest'
const RATE_LIMIT_MS = 300
const SOURCE_NAME = 'fueleconomy.gov (U.S. Dept. of Energy)'

interface FuelEconomyVehicle {
  id?: number
  make?: string
  model?: string
  year?: number
  trany?: string
  drive?: string
  fuelType?: string
  baseModel?: string
  // MSRP fields — only present in some records
  msrpLow?: number | string | null
  msrpHigh?: number | string | null
  startStop?: string
}

interface FuelEconomyVehicleListResponse {
  vehicle?: FuelEconomyVehicle | FuelEconomyVehicle[]
}

interface FuelEconomyMenuItem {
  text?: string
  value?: string
}

interface FuelEconomyMenuResponse {
  menuItem?: FuelEconomyMenuItem | FuelEconomyMenuItem[]
}


/** Fetch all model name variants for a given year/make (e.g. "Sienna 2WD", "Sienna AWD"). */
async function fetchModelNames(year: number, make: string): Promise<string[]> {
  const url = `${FUELECONOMY_BASE}/vehicle/menu/model?year=${year}&make=${encodeURIComponent(make)}`
  let res: Response
  try {
    res = await fetchWithRetry(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
    })
  } catch {
    return []
  }
  try {
    const data = (await res.json()) as FuelEconomyMenuResponse
    if (!data.menuItem) return []
    const items = Array.isArray(data.menuItem) ? data.menuItem : [data.menuItem]
    return items.map((m) => m.value ?? m.text ?? '').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Parse a raw MSRP value (may be string "$29,990" or number 29990) into cents.
 * Returns null if the value is absent, zero, or unparseable.
 */
function parseMsrpToCents(raw: number | string | null | undefined): number | null {
  if (raw == null) return null
  const numeric =
    typeof raw === 'number'
      ? raw
      : parseFloat(String(raw).replace(/[$,]/g, ''))
  if (!isFinite(numeric) || numeric <= 0) return null
  return Math.round(numeric * 100)
}

async function fetchVehiclesByYearMakeModel(
  year: number,
  make: string,
  model: string,
): Promise<FuelEconomyVehicle[]> {
  const url = `${FUELECONOMY_BASE}/vehicle/menu/options?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`
  let res: Response
  try {
    res = await fetchWithRetry(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WivWav/1.0 (wivwav.com)',
      },
    })
  } catch {
    return []
  }
  try {
    const data = (await res.json()) as FuelEconomyVehicleListResponse
    // API returns a single object when there is exactly one result
    if (!data.vehicle) return []
    return Array.isArray(data.vehicle) ? data.vehicle : [data.vehicle]
  } catch {
    return []
  }
}

async function fetchVehicleDetail(vehicleId: number): Promise<FuelEconomyVehicle | null> {
  const url = `${FUELECONOMY_BASE}/vehicle/${vehicleId}`
  let res: Response
  try {
    res = await fetchWithRetry(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WivWav/1.0 (wivwav.com)',
      },
    })
  } catch {
    return null
  }
  try {
    return (await res.json()) as FuelEconomyVehicle
  } catch {
    return null
  }
}

export interface FuelEconomyMsrpJobData {
  vehicleModelId?: string
}

/**
 * For each VehicleModel, query fueleconomy.gov for the original MSRP.
 * Results are upserted into vehicle_model_pricing (one row per VehicleModel).
 * When multiple trim variants are returned the lowest msrpLow value is stored
 * as the base MSRP since we normalize at model level, not individual option packages.
 */
export async function runFuelEconomyMsrpJob(
  context?: JobContext,
  data?: FuelEconomyMsrpJobData,
): Promise<void> {
  const db = getDb()

  const models = await db.vehicleModel.findMany({
    ...(data?.vehicleModelId ? { where: { id: data.vehicleModelId } } : {}),
    select: { id: true, make: true, model: true, year: true },
  })

  await report(context, `[fueleconomy-msrp] ${models.length} vehicle model(s) to refresh`, {
    stage: 'fetching',
    current: 0,
    total: models.length,
  })

  let upserted = 0

  for (let i = 0; i < models.length; i++) {
    const vm = models[i]!

    const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())
    const apiMake = titleCase(vm.make)
    const apiModelBase = titleCase(vm.model)

    // fueleconomy.gov appends drivetrain suffixes ("Sienna 2WD", "Sienna AWD"),
    // so we fetch all model names for the year/make and prefix-match.
    await jitteredSleep(RATE_LIMIT_MS)
    const modelNames = await fetchModelNames(vm.year, apiMake)
    const matchingModelNames = modelNames.filter((name) =>
      name.toLowerCase().startsWith(apiModelBase.toLowerCase()),
    )

    const variants: FuelEconomyVehicle[] = []
    for (const modelName of matchingModelNames) {
      await jitteredSleep(RATE_LIMIT_MS)
      const found = await fetchVehiclesByYearMakeModel(vm.year, apiMake, modelName)
      variants.push(...found)
    }

    // Collect per-variant MSRP candidates via detail endpoint when the list
    // response does not include msrpLow directly.
    let bestMsrpCents: number | null = null
    let bestVariantId: number | null = null
    let sourcePayload: unknown = null

    for (const variant of variants) {
      // Only fetch and sleep when there is a numeric vehicle ID to request
      if (!variant.id) continue
      await jitteredSleep(RATE_LIMIT_MS)
      const detail = await fetchVehicleDetail(variant.id)
      if (!detail) continue

      const candidate = parseMsrpToCents(detail.msrpLow ?? detail.msrpHigh)
      if (candidate !== null && (bestMsrpCents === null || candidate < bestMsrpCents)) {
        bestMsrpCents = candidate
        bestVariantId = variant.id
        sourcePayload = detail
      }
    }

    if (bestMsrpCents !== null) {
      const sourceUrl = `https://www.fueleconomy.gov/feg/Find.do?action=sbs&id=${bestVariantId ?? ''}`
      await db.vehicleModelPricing.upsert({
        where: { vehicleModelId: vm.id },
        update: {
          originalMsrpCents: bestMsrpCents,
          sourceName: SOURCE_NAME,
          sourceUrl,
          sourceFetchedAt: new Date(),
          sourcePayload: sourcePayload as object,
          updatedAt: new Date(),
        },
        create: {
          vehicleModelId: vm.id,
          originalMsrpCents: bestMsrpCents,
          sourceName: SOURCE_NAME,
          sourceUrl,
          sourceFetchedAt: new Date(),
          sourcePayload: sourcePayload as object,
        },
      })
      upserted++
    }

    await report(
      context,
      `[fueleconomy-msrp] ${i + 1}/${models.length} — ${vm.year} ${vm.make} ${vm.model}: ${bestMsrpCents !== null ? `$${(bestMsrpCents / 100).toLocaleString()}` : 'no MSRP'}`,
      { stage: 'fetching', current: i + 1, total: models.length },
    )

  }

  await report(
    context,
    `[fueleconomy-msrp] Done. ${upserted} MSRP record(s) upserted across ${models.length} model(s).`,
    { stage: 'complete', current: models.length, total: models.length },
  )
  await db.$disconnect()
}
