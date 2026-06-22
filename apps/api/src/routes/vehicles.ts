import type { FastifyPluginAsync } from 'fastify'
import type { VehicleRepository } from '../repositories/index.js'

interface VehiclesPluginOptions {
  vehicles: VehicleRepository
}

export const vehicleRoutes: FastifyPluginAsync<VehiclesPluginOptions> = async (app, { vehicles }) => {
  app.get<{ Params: { make: string; model: string; year: string } }>(
    '/:make/:model/:year/recalls',
    async (req, reply) => {
      const year = parseInt(req.params.year)
      if (isNaN(year)) return reply.badRequest('year must be a number')

      const vm = await vehicles.findModel(req.params.make, req.params.model, year)
      if (!vm) return reply.send({ data: [] })

      const recalls = await vehicles.findRecalls(vm.id)

      return reply.send({ data: recalls })
    },
  )

  app.get<{ Params: { make: string; model: string }; Querystring: { year?: string } }>(
    '/:make/:model/stats',
    async (req, reply) => {
      const year = req.query.year !== undefined ? parseInt(req.query.year) : undefined
      if (year !== undefined && isNaN(year)) return reply.badRequest('year must be a number')

      const stats = await vehicles.findStats(req.params.make, req.params.model, year ?? null)

      if (!stats) return reply.send({ data: null })
      const { dataSourceName, dataSourceUrl, ...statsData } = stats
      // Both fields must be non-null to produce a source entry; a name-only or URL-only
      // row is treated as unpublished and returns an empty array.
      return reply.send({
        data: {
          ...statsData,
          sources:
            dataSourceName !== null && dataSourceUrl !== null
              ? [{ name: dataSourceName, url: dataSourceUrl }]
              : [],
        },
      })
    },
  )

  app.get<{ Params: { make: string; model: string; year: string } }>(
    '/:make/:model/:year/complaints',
    async (req, reply) => {
      const year = parseInt(req.params.year)
      if (isNaN(year)) return reply.badRequest('year must be a number')

      const vm = await vehicles.findModel(req.params.make, req.params.model, year)
      if (!vm) return reply.send({ data: [] })

      const complaints = await vehicles.findComplaints(vm.id)

      return reply.send({ data: complaints })
    },
  )

  app.get<{ Params: { make: string; model: string; year: string } }>(
    '/:make/:model/:year/investigations',
    async (req, reply) => {
      const year = parseInt(req.params.year)
      if (isNaN(year)) return reply.badRequest('year must be a number')

      const vm = await vehicles.findModel(req.params.make, req.params.model, year)
      if (!vm) return reply.send({ data: [] })

      const investigations = await vehicles.findInvestigations(vm.id)

      return reply.send({ data: investigations })
    },
  )

  app.get<{ Params: { make: string; model: string; year: string } }>(
    '/:make/:model/:year/communications',
    async (req, reply) => {
      const year = parseInt(req.params.year)
      if (isNaN(year)) return reply.badRequest('year must be a number')

      const vm = await vehicles.findModel(req.params.make, req.params.model, year)
      if (!vm) return reply.send({ data: [] })

      const communications = await vehicles.findManufacturerCommunications(vm.id)

      return reply.send({ data: communications })
    },
  )

  // GET /v1/vehicles/:make/:model/:year/research — latest cited model facts
  app.get<{ Params: { make: string; model: string; year: string } }>(
    '/:make/:model/:year/research',
    async (req, reply) => {
      const year = parseInt(req.params.year)
      if (isNaN(year)) return reply.badRequest('year must be a number')

      const vm = await vehicles.findModel(req.params.make, req.params.model, year)
      if (!vm) return reply.send({ data: null })

      const research = await vehicles.findResearch(vm.id)

      if (!research) return reply.send({ data: null })

      return reply.send({
        data: {
          vehicleModel: { id: vm.id, make: vm.make, model: vm.model, year: vm.year },
          researchVersion: research.researchVersion,
          researchedAt: research.researchedAt,
          sources: research.sources,
          claims: research.claims,
        },
      })
    },
  )

  // GET /v1/vehicles/:make/:model/:year/msrp — original MSRP from fueleconomy.gov
  app.get<{ Params: { make: string; model: string; year: string } }>(
    '/:make/:model/:year/msrp',
    async (req, reply) => {
      const year = parseInt(req.params.year)
      if (isNaN(year)) return reply.badRequest('year must be a number')

      const vm = await vehicles.findModel(req.params.make, req.params.model, year)
      if (!vm) return reply.send({ data: null })

      const msrp = await vehicles.findMsrp(vm.id)
      if (!msrp) return reply.send({ data: null })

      return reply.send({
        data: {
          vehicleModel: { id: vm.id, make: vm.make, model: vm.model, year: vm.year },
          originalMsrpCents: msrp.originalMsrpCents,
          destinationFeeCents: msrp.destinationFeeCents,
          currency: msrp.currency,
          source: {
            name: msrp.sourceName,
            url: msrp.sourceUrl,
            fetchedAt: msrp.sourceFetchedAt,
          },
        },
      })
    },
  )
}
