/**
 * Model research handler (#963) — fetches cited vehicle spec data from the
 * EPA FuelEconomy.gov API and stores claims with source URLs for display on
 * listing detail pages. Ported from `apps/scraper/src/jobs/model-research.ts`
 * onto the `http-enrich` gateway.
 *
 * Source: EPA FuelEconomy.gov API (public, no key required, MIT-friendly terms)
 */
import { report, jitteredSleep } from '@wivwav/scraper-sources'
import type { WivWavLogger } from '@wivwav/logger'
import {
  modelResearchJobPayloadSchema,
  type ModelResearchJobResult,
} from '@wivwav/types/http-enrich-gateway'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createJobContext } from '../job-context.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'

const RESEARCH_VERSION = 1
const RATE_LIMIT_MS = 300

const EPA_SOURCE_NAME = 'EPA FuelEconomy.gov'
const EPA_SOURCE_URL_BASE = 'https://www.fueleconomy.gov/feg/bymodel'

interface EpaVehicle {
  id: number
  make: string
  model: string
  year: number
  trany?: string
  drive?: string
  displ?: number
  cylinders?: number
  pv4?: number // combined MPG (petroleum vehicles)
  city08?: number
  hwy08?: number
  combMpgData?: number
  cityMpgData?: number
  hwyMpgData?: number
  fuelType?: string
  eng_dscr?: string
}

interface EpaVehiclesResponse {
  vehicle?: EpaVehicle[]
}

async function fetchEpaData(make: string, model: string, year: number): Promise<EpaVehicle | null> {
  try {
    const params = new URLSearchParams({ make, model, year: String(year), format: 'json' })
    const url = `https://www.fueleconomy.gov/ws/rest/ympg/shared/vehicles?${params}`
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as EpaVehiclesResponse
    const vehicles = data.vehicle ?? []
    if (vehicles.length === 0) return null
    // Prefer the first result; EPA sometimes returns multiple trims
    return vehicles[0] ?? null
  } catch {
    return null
  }
}

interface ClaimInput {
  field: string
  claimText: string
  confidence: 'high' | 'medium' | 'low'
}

function buildEpaClaims(epa: EpaVehicle): ClaimInput[] {
  const claims: ClaimInput[] = []

  if (epa.city08 && epa.city08 > 0) {
    claims.push({ field: 'fuelEconomyCity', claimText: `${epa.city08} MPG city`, confidence: 'high' })
  }

  if (epa.hwy08 && epa.hwy08 > 0) {
    claims.push({ field: 'fuelEconomyHwy', claimText: `${epa.hwy08} MPG highway`, confidence: 'high' })
  }

  const combined = epa.combMpgData ?? epa.pv4
  if (combined && combined > 0) {
    claims.push({ field: 'fuelEconomyCombined', claimText: `${combined} MPG combined`, confidence: 'high' })
  }

  if (epa.drive) {
    claims.push({ field: 'drivetrain', claimText: epa.drive, confidence: 'high' })
  }

  if (epa.eng_dscr) {
    claims.push({ field: 'engineDescription', claimText: epa.eng_dscr, confidence: 'high' })
  } else if (epa.displ && epa.cylinders) {
    claims.push({
      field: 'engineDescription',
      claimText: `${epa.displ}L ${epa.cylinders}-cylinder`,
      confidence: 'high',
    })
  }

  if (epa.fuelType) {
    claims.push({ field: 'fuelType', claimText: epa.fuelType, confidence: 'high' })
  }

  if (epa.trany) {
    claims.push({ field: 'transmission', claimText: epa.trany, confidence: 'high' })
  }

  return claims
}

export function createModelResearchHandler(gateway: HttpEnrichGatewayClient, logger: WivWavLogger) {
  return async (payload: unknown, correlationId: string): Promise<ModelResearchJobResult> => {
    modelResearchJobPayloadSchema.parse(payload ?? {})
    const context = createJobContext(logger, correlationId)

    const { vehicleModels } = await gateway.listModelResearchPending(RESEARCH_VERSION)

    await report(context, `[model-research] ${vehicleModels.length} vehicle model(s) to research`, {
      stage: 'starting',
      current: 0,
      total: vehicleModels.length,
    })

    let processed = 0

    for (let i = 0; i < vehicleModels.length; i++) {
      const vm = vehicleModels[i]!

      const epaData = await fetchEpaData(vm.make, vm.model, vm.year)

      if (!epaData) {
        await report(
          context,
          `[model-research] ${i + 1}/${vehicleModels.length} — ${vm.year} ${vm.make} ${vm.model}: no EPA data found`,
          { stage: 'processing', current: i + 1, total: vehicleModels.length },
        )
        if (i < vehicleModels.length - 1) await jitteredSleep(RATE_LIMIT_MS)
        continue
      }

      const claims = buildEpaClaims(epaData)
      if (claims.length === 0) {
        await report(
          context,
          `[model-research] ${i + 1}/${vehicleModels.length} — ${vm.year} ${vm.make} ${vm.model}: EPA response had no recognizable fields`,
          { stage: 'processing', current: i + 1, total: vehicleModels.length },
        )
        if (i < vehicleModels.length - 1) await jitteredSleep(RATE_LIMIT_MS)
        continue
      }

      // EPA source URL — spaces become underscores (fueleconomy.gov convention);
      // remaining special chars (parens, slashes) are percent-encoded for validity.
      const makeSlug = encodeURIComponent(vm.make.replace(/ /g, '_'))
      const modelSlug = encodeURIComponent(vm.model.replace(/ /g, '_'))
      const epaUrl = `${EPA_SOURCE_URL_BASE}/${vm.year}_${makeSlug}_${modelSlug}.shtml`

      const { created } = await gateway.submitModelResearch({
        vehicleModelId: vm.id,
        researchVersion: RESEARCH_VERSION,
        sourceName: EPA_SOURCE_NAME,
        sourceUrl: epaUrl,
        claims,
      })

      if (created) {
        processed++
        await report(
          context,
          `[model-research] ${i + 1}/${vehicleModels.length} — ${vm.year} ${vm.make} ${vm.model}: ${claims.length} claim(s) stored`,
          { stage: 'processing', current: i + 1, total: vehicleModels.length },
        )
      } else {
        // A concurrent worker already wrote this (vehicleModelId, researchVersion)
        // pair — skip gracefully, mirroring the original job's P2002 catch.
        await report(
          context,
          `[model-research] ${i + 1}/${vehicleModels.length} — ${vm.year} ${vm.make} ${vm.model}: already researched by a concurrent run, skipping`,
          { stage: 'processing', current: i + 1, total: vehicleModels.length },
        )
      }

      if (i < vehicleModels.length - 1) await jitteredSleep(RATE_LIMIT_MS)
    }

    await report(
      context,
      `[model-research] Done. ${processed} model(s) researched.`,
      { stage: 'complete', current: vehicleModels.length, total: vehicleModels.length },
    )

    return { processed }
  }
}
