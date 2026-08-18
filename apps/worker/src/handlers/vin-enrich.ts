import { report, jitteredSleep } from '@wivwav/scraper-sources'
import type { WivWavLogger } from '@wivwav/logger'
import {
  vinEnrichJobPayloadSchema,
  type VinEnrichJobResult,
} from '@wivwav/types/http-enrich-gateway'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createJobContext } from '../job-context.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'
import { validateAuthoritativeMismatch } from '../engine/listing-validator.js'

const VPIC_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevin'
const RATE_LIMIT_MS = 200
const CLAIM_BATCH_SIZE = 100

interface VpicResult {
  Variable: string
  Value: string | null
}

interface VpicResponse {
  Results: VpicResult[]
}

function getValue(results: VpicResult[], variable: string): string | null {
  const r = results.find((r) => r.Variable === variable)
  const v = r?.Value?.trim()
  return v && v !== 'Not Applicable' ? v : null
}

function normalizeVehicleField(s: string | null | undefined): string | null {
  if (!s) return null
  return s.trim().toLowerCase()
}

async function decodeVin(
  vin: string,
): Promise<{ make: string; model: string; year: number; trim: string | null; bodyType: string | null } | null> {
  let res: Response
  try {
    res = await fetchWithRetry(`${VPIC_URL}/${encodeURIComponent(vin)}?format=json`, {
      headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
    })
  } catch {
    return null
  }

  const data: VpicResponse = await res.json()
  const make = getValue(data.Results, 'Make')
  const model = getValue(data.Results, 'Model')
  const yearStr = getValue(data.Results, 'Model Year')
  const year = yearStr ? parseInt(yearStr) : NaN

  if (!make || !model || isNaN(year)) return null

  return {
    make,
    model,
    year,
    trim: getValue(data.Results, 'Trim'),
    bodyType: getValue(data.Results, 'Body Class'),
  }
}

/**
 * VIN_ENRICH handler (#963): ported from `apps/scraper/src/jobs/vin-enrich.ts`
 * onto the `http-enrich` gateway. The row lock, vehicle-model
 * find-or-create, listing update, and LISTING_RESOLVE enqueue all move
 * server-side into `/vin-enrich/claim` and `/vin-enrich/resolve` (see
 * apps/api's `HttpEnrichGatewayRepository` and `internal-http-enrich.ts`) —
 * this handler keeps only the vPIC HTTP call and the pure
 * `validateAuthoritativeMismatch` comparison, neither of which touch the DB.
 */
export function createVinEnrichHandler(gateway: HttpEnrichGatewayClient, logger: WivWavLogger) {
  return async (payload: unknown, correlationId: string): Promise<VinEnrichJobResult> => {
    vinEnrichJobPayloadSchema.parse(payload ?? {})
    const context = createJobContext(logger, correlationId)

    const { listings } = await gateway.claimVinEnrichListings(CLAIM_BATCH_SIZE)

    await report(context, `[vin-enrich] ${listings.length} listing(s) claimed for VIN decode`, {
      stage: 'decoding',
      current: 0,
      total: listings.length,
    })

    let processed = 0
    let failed = 0

    for (let i = 0; i < listings.length; i++) {
      const { id, vin, make: scrapedMake, model: scrapedModel, year: scrapedYear } = listings[i]!

      const decoded = await decodeVin(vin)

      if (decoded) {
        const mismatchIssues = validateAuthoritativeMismatch(
          { make: scrapedMake, model: scrapedModel, year: scrapedYear },
          { make: decoded.make, model: decoded.model, year: decoded.year },
        )

        if (mismatchIssues.length > 0) {
          const qualityIssueCodes = [...new Set(mismatchIssues.map((issue) => issue.rule))]
          await gateway.resolveVinEnrichListing({ listingId: id, outcome: 'mismatched', qualityIssueCodes })
          processed++
          await report(
            context,
            `[vin-enrich] ${i + 1}/${listings.length} — ${vin}: NHTSA mismatch (scraped ${scrapedMake} ${scrapedModel} ${scrapedYear} vs decoded ${decoded.make} ${decoded.model} ${decoded.year}) — quarantined`,
            { stage: 'decoding', current: i + 1, total: listings.length },
          )
        } else {
          const make = normalizeVehicleField(decoded.make)!
          const model = normalizeVehicleField(decoded.model)!
          const trim = normalizeVehicleField(decoded.trim)
          const bodyType = normalizeVehicleField(decoded.bodyType)

          await gateway.resolveVinEnrichListing({
            listingId: id,
            outcome: 'enriched',
            decoded: { make, model, year: decoded.year, trim, bodyType },
          })
          processed++

          await report(
            context,
            `[vin-enrich] ${i + 1}/${listings.length} — ${vin} → ${decoded.make} ${decoded.model} ${decoded.year}`,
            { stage: 'decoding', current: i + 1, total: listings.length },
          )
        }
      } else {
        await gateway.resolveVinEnrichListing({ listingId: id, outcome: 'failed' })
        failed++
        await report(context, `[vin-enrich] ${i + 1}/${listings.length} — ${vin} → decode failed`, {
          stage: 'decoding',
          current: i + 1,
          total: listings.length,
        })
      }

      if (i < listings.length - 1) await jitteredSleep(RATE_LIMIT_MS)
    }

    await report(context, `[vin-enrich] Done. ${processed} processed, ${failed} failed.`, {
      stage: 'complete',
      current: listings.length,
      total: listings.length,
    })

    return { processed }
  }
}
