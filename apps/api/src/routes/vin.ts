import type { FastifyPluginAsync } from 'fastify'
import { normalizeVin } from '@wivwav/db'
import type { VehicleRepository, ListingRepository, ApiKeyRepository } from '../repositories/index.js'
import { decodeVin, isValidVin } from '../services/vin-decoder.js'
import { resolveApiKeyTier, tierAtLeast } from '../services/api-key-tier.js'

interface VinPluginOptions {
  vehicles: VehicleRepository
  listings: ListingRepository
  apiKeys: ApiKeyRepository
}

interface ComplaintGroup {
  component: string
  count: number
  examples: Array<{
    id: string
    nhtsaId: string
    summary: string
    mileage: number | null
    crashInvolved: boolean
    reportedAt: Date
  }>
}

interface RawRecall {
  id: string
  nhtsaCampaignId: string
  component: string
  summary: string
  remedy: string | null
  reportedAt: Date
}

type RecallStatus = 'open' | 'remedied'

function normalizeRecallStatus(remedy: string | null): RecallStatus {
  if (remedy === null || remedy.trim() === '') return 'open'
  return 'remedied'
}

export const vinRoutes: FastifyPluginAsync<VinPluginOptions> = async (app, { vehicles, listings, apiKeys }) => {
  /**
   * GET /v1/vin/:vin/listings
   *
   * All active, publication-eligible listings across sources for a VIN.
   * FREE tier — powers the cross-listing section of the listing detail page.
   *
   * Example response:
   * ```json
   * { "data": { "vin": "5TDYK3DC1FS123456", "listings": [
   *   { "id": "cl1", "sourceUrl": "https://...", "dealerName": "Acme Vans",
   *     "priceCents": 4500000, "mileage": 32000, "status": "active",
   *     "listedAt": "2026-05-01T00:00:00.000Z", "goneAt": null, "soldAt": null }
   * ] } }
   * ```
   */
  app.get<{ Params: { vin: string } }>('/:vin/listings', async (req, reply) => {
    const vin = normalizeVin(req.params.vin)
    if (!isValidVin(vin)) return reply.badRequest('VIN must be 17 characters and cannot contain I, O, or Q')

    const rows = await listings.findListingsByVin(vin, true)
    return reply.send({
      data: {
        vin,
        listings: rows.map((r) => ({
          id: r.id,
          sourceUrl: r.sourceUrl,
          dealerName: r.dealerName,
          priceCents: r.priceCents,
          mileage: r.mileage,
          status: r.status,
          listedAt: r.listedAt.toISOString(),
          goneAt: r.goneAt ? r.goneAt.toISOString() : null,
          soldAt: r.soldAt ? r.soldAt.toISOString() : null,
        })),
      },
    })
  })

  /**
   * GET /v1/vin/:vin/history
   *
   * Merged price and mileage history for every listing (any status, any
   * source) matching a VIN, ordered by `recordedAt` ascending. PRO+ only —
   * returns 403 `upgrade_required` for FREE-tier callers.
   *
   * Example response:
   * ```json
   * { "data": { "vin": "5TDYK3DC1FS123456", "history": [
   *   { "listingId": "cl1", "type": "price", "value": 4700000, "recordedAt": "2026-04-01T00:00:00.000Z" },
   *   { "listingId": "cl1", "type": "mileage", "value": 31000, "recordedAt": "2026-04-01T00:00:00.000Z" },
   *   { "listingId": "cl1", "type": "price", "value": 4500000, "recordedAt": "2026-05-01T00:00:00.000Z" }
   * ] } }
   * ```
   */
  app.get<{ Params: { vin: string } }>('/:vin/history', async (req, reply) => {
    const vin = normalizeVin(req.params.vin)
    if (!isValidVin(vin)) return reply.badRequest('VIN must be 17 characters and cannot contain I, O, or Q')

    const tier = await resolveApiKeyTier(apiKeys, req.headers)
    if (!tierAtLeast(tier, 'PRO')) {
      return reply.code(403).send({
        error: { code: 'upgrade_required', message: 'GET /v1/vin/:vin/history requires a PRO or higher API key' },
      })
    }

    const rows = await listings.findHistoryByVin(vin)
    return reply.send({
      data: {
        vin,
        history: rows.map((r) => ({
          listingId: r.listingId,
          type: r.type,
          value: r.value,
          recordedAt: r.recordedAt.toISOString(),
        })),
      },
    })
  })

  app.get<{ Params: { vin: string } }>('/:vin/safety', async (req, reply) => {
    const vin = normalizeVin(req.params.vin)
    if (!isValidVin(vin)) return reply.badRequest('VIN must be 17 characters and cannot contain I, O, or Q')

    const decoded = await decodeVin(vin)
    if (!decoded) {
      return reply.send({
        data: {
          vin,
          decoded: null,
          vehicleModel: null,
          conversionManufacturer: null,
          sourceListingId: null,
          recalls: [],
          complaints: [],
          complaintGroups: [],
          safetyRatings: [],
          checkedAt: new Date().toISOString(),
        },
      })
    }

    const [vehicleModelRow, sourceListing] = await Promise.all([
      vehicles.findModel(decoded.make, decoded.model, decoded.year),
      listings.findByVin(vin),
    ])

    const vehicleModel = vehicleModelRow
      ? await listings.findVehicleModelWithSafetyData(vehicleModelRow.id)
      : null

    const complaints = vehicleModel?.complaints ?? []
    const rawRecalls: RawRecall[] = vehicleModel?.recalls ?? []
    const recalls = rawRecalls.map((r) => ({ ...r, status: normalizeRecallStatus(r.remedy) }))

    return reply.send({
      data: {
        vin,
        decoded,
        vehicleModel: vehicleModel
          ? { id: vehicleModel.id, make: vehicleModel.make, model: vehicleModel.model, year: vehicleModel.year, trim: vehicleModel.trim, bodyType: vehicleModel.bodyType }
          : null,
        conversionManufacturer: sourceListing?.conversionManufacturer ?? null,
        sourceListingId: sourceListing?.id ?? null,
        recalls,
        complaints,
        complaintGroups: groupComplaints(complaints),
        safetyRatings: vehicleModel?.safetyRatings ?? [],
        checkedAt: new Date().toISOString(),
      },
    })
  })
}

function groupComplaints(complaints: Array<ComplaintGroup['examples'][number] & { component: string }>): ComplaintGroup[] {
  const groups = new Map<string, ComplaintGroup>()

  for (const complaint of complaints) {
    const component = complaint.component || 'Uncategorized'
    const group = groups.get(component) ?? { component, count: 0, examples: [] }
    group.count += 1
    if (group.examples.length < 3) {
      group.examples.push({
        id: complaint.id,
        nhtsaId: complaint.nhtsaId,
        summary: complaint.summary,
        mileage: complaint.mileage,
        crashInvolved: complaint.crashInvolved,
        reportedAt: complaint.reportedAt,
      })
    }
    groups.set(component, group)
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || a.component.localeCompare(b.component))
}
