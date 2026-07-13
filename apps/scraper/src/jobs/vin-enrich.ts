import { getDb } from '@wivwav/db'
import { CRITICAL_JOB_OPTIONS, type JobContext, type QueueAdapter } from '@wivwav/queue'
import { report } from './job-progress.js'
import { normalizeVehicleField, type VehicleModelMatchConfidence } from './normalize-vehicle-fields.js'
import { acquireListingLock, releaseListingLock, unlockableWhere } from './listing-lock.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { fetchWithRetry } from '../util/fetch-with-retry.js'
import { validateAuthoritativeMismatch } from '../engine/listing-validator.js'

const VPIC_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevin'
const RATE_LIMIT_MS = 200

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


async function findOrCreateVehicleModel(
  db: ReturnType<typeof getDb>,
  make: string,
  model: string,
  year: number,
  trim: string | null,
  bodyType: string | null,
): Promise<{ id: string; bodyType: string | null; confidence: VehicleModelMatchConfidence }> {
  // Exact match (make + model + year + trim, all normalized)
  let vehicleModel = await db.vehicleModel.findFirst({
    where: { make, model, year, trim },
  })
  if (vehicleModel) {
    if (bodyType && !vehicleModel.bodyType) {
      vehicleModel = await db.vehicleModel.update({ where: { id: vehicleModel.id }, data: { bodyType } })
    }
    return { id: vehicleModel.id, bodyType: vehicleModel.bodyType, confidence: 'exact' }
  }

  // Trim fallback: if the decoded VIN had a trim but no record matches it, try without trim
  if (trim !== null) {
    const fallback = await db.vehicleModel.findFirst({ where: { make, model, year, trim: null } })
    if (fallback) {
      return { id: fallback.id, bodyType: fallback.bodyType, confidence: 'trim_fallback' }
    }
  }

  // No match — create a new canonical record
  const created = await db.vehicleModel.create({ data: { make, model, year, trim, bodyType } })
  return { id: created.id, bodyType: created.bodyType, confidence: 'exact' }
}

export async function runVinEnrichJob(context?: JobContext, resolutionQueue?: QueueAdapter): Promise<void> {
  const db = getDb()

  // Exclude listings locked by another concurrent job (e.g. geocode, deduplicate)
  const listings = await db.listing.findMany({
    where: {
      vin: { not: null },
      vehicleModelId: null,
      ...unlockableWhere(),
    },
    select: { id: true, vin: true, make: true, model: true, year: true },
  })

  await report(context, `[vin-enrich] ${listings.length} listing(s) need VIN decode`, {
    stage: 'decoding',
    current: 0,
    total: listings.length,
  })

  let enriched = 0
  let failed = 0
  let skipped = 0
  let mismatched = 0

  for (let i = 0; i < listings.length; i++) {
    const { id, vin, make: scrapedMake, model: scrapedModel, year: scrapedYear } = listings[i]!

    // Acquire the row lock before decoding — another job may have locked this row
    // between the initial findMany and now (e.g. geocode running concurrently)
    const acquired = await acquireListingLock(db, id)
    if (!acquired) {
      skipped++
      await report(
        context,
        `[vin-enrich] ${i + 1}/${listings.length} — ${vin}: locked by another job, skipping`,
        { stage: 'decoding', current: i + 1, total: listings.length },
      )
      if (i < listings.length - 1) await jitteredSleep(RATE_LIMIT_MS)
      continue
    }

    try {
      const decoded = await decodeVin(vin!)

      if (decoded) {
        // Authoritative mismatch check: compare the NHTSA vPIC decode against the
        // scraped make/model/year for this same VIN. A credible mismatch means the
        // scraped identity fields (or, less commonly, the VIN itself) are wrong —
        // silently linking to the decoded vehicle model would misrepresent the
        // listing. Quarantine the listing's identity fields instead and skip the
        // vehicle-model link entirely; an operator must resolve the conflict.
        const mismatchIssues = validateAuthoritativeMismatch(
          { make: scrapedMake, model: scrapedModel, year: scrapedYear },
          { make: decoded.make, model: decoded.model, year: decoded.year },
        )

        if (mismatchIssues.length > 0) {
          const qualityIssueCodes = [...new Set(mismatchIssues.map((issue) => issue.rule))]
          await db.listing.update({
            where: { id },
            data: {
              publicationStatus: 'quarantined',
              qualityIssueCodes,
              qualityCheckedAt: new Date(),
            },
          })
          mismatched++
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

          const { id: vehicleModelId, confidence } = await findOrCreateVehicleModel(
            db,
            make,
            model,
            decoded.year,
            trim,
            bodyType,
          )

          await db.listing.update({
            where: { id },
            data: {
              vehicleModelId,
              vehicleModelMatchConfidence: confidence,
              // New authoritative vehicle identity evidence requires a fresh
              // quality decision before the listing can be public again.
              publicationStatus: 'pending',
              qualityIssueCodes: [],
              qualityCheckedAt: null,
            },
          })
          // Guarantee a path back to eligible/quarantined (#652) — vin-enrich
          // is a regular unattended schedule, not a one-off backfill, so a
          // listing it invalidates cannot rely on an unrelated future
          // source-scrape or detail-extract to trigger resolution.
          await resolutionQueue?.add(
            { listingId: id, observationReference: `vin-enrich:${id}:${new Date().toISOString()}` },
            CRITICAL_JOB_OPTIONS,
          )
          enriched++

          await report(
            context,
            `[vin-enrich] ${i + 1}/${listings.length} — ${vin} → ${decoded.make} ${decoded.model} ${decoded.year}`,
            { stage: 'decoding', current: i + 1, total: listings.length },
          )
        }
      } else {
        failed++
        await report(
          context,
          `[vin-enrich] ${i + 1}/${listings.length} — ${vin} → decode failed`,
          { stage: 'decoding', current: i + 1, total: listings.length },
        )
      }
    } finally {
      await releaseListingLock(db, id)
    }

    if (i < listings.length - 1) await jitteredSleep(RATE_LIMIT_MS)
  }

  // VIN enrichment is committed to Postgres above. Search-index sync is no
  // longer this job's concern — the single-owner indexer poller (#669) picks
  // up any touched listing on its next tick.
  await report(context, `[vin-enrich] Done. ${enriched} enriched, ${mismatched} quarantined (NHTSA mismatch), ${failed} failed, ${skipped} skipped (locked).`, {
    stage: 'complete',
    current: listings.length,
    total: listings.length,
  })
  await db.$disconnect()
}
