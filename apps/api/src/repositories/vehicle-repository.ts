import type { PrismaClient } from '@wivwav/db'

// ── Shape types ──────────────────────────────────────────────────────────────

export type VehicleModelRow = {
  id: string
  make: string
  model: string
  year: number
}

export type RecallRow = {
  id: string
  nhtsaCampaignId: string
  component: string
  summary: string
  remedy: string | null
  reportedAt: Date
}

export type ComplaintRow = {
  id: string
  nhtsaId: string
  component: string
  summary: string
  mileage: number | null
  crashInvolved: boolean
  reportedAt: Date
}

export type VehicleStatsRow = {
  make: string
  model: string
  year: number | null
  avgLifespanMiles: number | null
  reliabilityScore: number | null
  reliabilitySource: string | null
  jdPowerScore: number | null
  dataSourceName: string | null
  dataSourceUrl: string | null
  methodology: string | null
  refreshedAt: Date | null
}

export type VehicleResearchRow = {
  id: string
  researchVersion: number
  researchedAt: Date
  sources: { id: string; sourceName: string; sourceUrl: string; fetchedAt: Date }[]
  claims: { id: string; field: string; claimText: string; confidence: string; sourceId: string | null }[]
}

export type MsrpRow = {
  originalMsrpCents: number | null
  destinationFeeCents: number | null
  currency: string
  sourceName: string
  sourceUrl: string
  sourceFetchedAt: Date
}

// ── Interface ────────────────────────────────────────────────────────────────

import type { InvestigationRow, ManufacturerCommunicationRow } from './listing-repository.js'
export type { InvestigationRow, ManufacturerCommunicationRow }

export interface VehicleRepository {
  findModel(make: string, model: string, year: number): Promise<VehicleModelRow | null>
  findRecalls(vehicleModelId: string): Promise<RecallRow[]>
  findComplaints(vehicleModelId: string): Promise<ComplaintRow[]>
  findInvestigations(vehicleModelId: string): Promise<InvestigationRow[]>
  findManufacturerCommunications(vehicleModelId: string): Promise<ManufacturerCommunicationRow[]>
  findStats(make: string, model: string, year: number | null): Promise<VehicleStatsRow | null>
  findResearch(vehicleModelId: string): Promise<VehicleResearchRow | null>
  findMsrp(vehicleModelId: string): Promise<MsrpRow | null>
}

// ── Prisma implementation ────────────────────────────────────────────────────

export class PrismaVehicleRepository implements VehicleRepository {
  constructor(private readonly db: PrismaClient) {}

  findModel(make: string, model: string, year: number): Promise<VehicleModelRow | null> {
    return this.db.vehicleModel.findFirst({ where: { make, model, year } })
  }

  findRecalls(vehicleModelId: string): Promise<RecallRow[]> {
    return this.db.recall.findMany({
      where: { vehicleModelId },
      orderBy: { reportedAt: 'desc' },
      select: {
        id: true,
        nhtsaCampaignId: true,
        component: true,
        summary: true,
        remedy: true,
        reportedAt: true,
      },
    })
  }

  findComplaints(vehicleModelId: string): Promise<ComplaintRow[]> {
    return this.db.complaint.findMany({
      where: { vehicleModelId },
      orderBy: { reportedAt: 'desc' },
      select: {
        id: true,
        nhtsaId: true,
        component: true,
        summary: true,
        mileage: true,
        crashInvolved: true,
        reportedAt: true,
      },
    })
  }

  findInvestigations(vehicleModelId: string): Promise<InvestigationRow[]> {
    return this.db.investigation.findMany({
      where: { vehicleModelId },
      orderBy: { openedDate: 'desc' },
      select: {
        id: true,
        nhtsaId: true,
        component: true,
        summary: true,
        openedDate: true,
        closedDate: true,
        outcome: true,
        sourceUrl: true,
        refreshedAt: true,
      },
    })
  }

  findManufacturerCommunications(vehicleModelId: string): Promise<ManufacturerCommunicationRow[]> {
    return this.db.manufacturerCommunication.findMany({
      where: { vehicleModelId },
      orderBy: { issuedDate: 'desc' },
      select: {
        id: true,
        nhtsaId: true,
        component: true,
        summary: true,
        issuedDate: true,
        sourceUrl: true,
        refreshedAt: true,
      },
    })
  }

  async findStats(make: string, model: string, year: number | null): Promise<VehicleStatsRow | null> {
    const select = {
      make: true,
      model: true,
      year: true,
      avgLifespanMiles: true,
      reliabilityScore: true,
      reliabilitySource: true,
      jdPowerScore: true,
      dataSourceName: true,
      dataSourceUrl: true,
      methodology: true,
      refreshedAt: true,
    } as const
    const baseWhere = { make, model }
    if (year !== null) {
      return (
        (await this.db.vehicleStats.findFirst({ where: { ...baseWhere, year }, select })) ??
        (await this.db.vehicleStats.findFirst({ where: { ...baseWhere, year: null }, select }))
      )
    }
    return this.db.vehicleStats.findFirst({ where: { ...baseWhere, year: null }, select })
  }

  findResearch(vehicleModelId: string): Promise<VehicleResearchRow | null> {
    return this.db.vehicleModelResearch.findFirst({
      where: { vehicleModelId },
      orderBy: { researchVersion: 'desc' },
      select: {
        id: true,
        researchVersion: true,
        researchedAt: true,
        sources: {
          select: {
            id: true,
            sourceName: true,
            sourceUrl: true,
            fetchedAt: true,
          },
        },
        claims: {
          orderBy: { field: 'asc' },
          select: {
            id: true,
            field: true,
            claimText: true,
            confidence: true,
            sourceId: true,
          },
        },
      },
    })
  }

  findMsrp(vehicleModelId: string): Promise<MsrpRow | null> {
    return this.db.vehicleModelPricing.findUnique({
      where: { vehicleModelId },
      select: {
        originalMsrpCents: true,
        destinationFeeCents: true,
        currency: true,
        sourceName: true,
        sourceUrl: true,
        sourceFetchedAt: true,
      },
    })
  }
}
