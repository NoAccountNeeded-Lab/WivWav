import type { FastifyPluginAsync } from 'fastify'
import { normalizeVin } from '@wivwav/db'
import type { VehicleRepository, ListingRepository } from '../repositories/index.js'
import { decodeVin, isValidVin } from '../services/vin-decoder.js'

interface VinPluginOptions {
  vehicles: VehicleRepository
  listings: ListingRepository
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

export const vinRoutes: FastifyPluginAsync<VinPluginOptions> = async (app, { vehicles, listings }) => {
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
