import type { FastifyPluginAsync } from 'fastify'
import type {
  VehicleIdentityDecisionRepository,
} from '../repositories/vehicle-identity-decision-repository.js'
import { NotFoundError, InvalidStateError } from '../repositories/vehicle-identity-decision-repository.js'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

interface CandidateListQuery {
  skip?: string
  take?: string
}

interface AdminVehicleIdentityPluginOptions {
  vehicleIdentityDecisions: VehicleIdentityDecisionRepository
}

export const adminVehicleIdentityRoutes: FastifyPluginAsync<AdminVehicleIdentityPluginOptions> =
  async (app, { vehicleIdentityDecisions }) => {
    // ── GET /admin/vehicle-identity/candidates ────────────────────────────────
    // List pending candidates with their contributing/conflicting signals, both
    // listing snapshots, and pagination metadata.
    app.get<{ Querystring: CandidateListQuery }>(
      '/candidates',
      async (req, reply) => {
        const parsedTake = Math.min(
          req.query.take
            ? Number.parseInt(req.query.take, 10) || DEFAULT_PAGE_SIZE
            : DEFAULT_PAGE_SIZE,
          MAX_PAGE_SIZE,
        )
        const parsedSkip = req.query.skip
          ? Math.max(Number.parseInt(req.query.skip, 10) || 0, 0)
          : 0

        const { data, total } = await vehicleIdentityDecisions.listCandidates({
          skip: parsedSkip,
          take: parsedTake,
        })

        return reply.send({ data, meta: { total, skip: parsedSkip, take: parsedTake } })
      },
    )

    // ── POST /admin/vehicle-identity/candidates/:id/approve ──────────────────
    // Approve a candidate: transition to `verified`, find-or-create a shared
    // Vehicle, and link both listings to it.
    app.post<{ Params: { id: string } }>(
      '/candidates/:id/approve',
      async (req, reply) => {
        try {
          const decision = await vehicleIdentityDecisions.approve(req.params.id)
          return reply.send({ data: decision })
        } catch (err) {
          if (err instanceof NotFoundError) return reply.notFound(err.message)
          throw err
        }
      },
    )

    // ── POST /admin/vehicle-identity/candidates/:id/reject ───────────────────
    // Reject a candidate: transition to `rejected` without linking listings.
    app.post<{ Params: { id: string } }>(
      '/candidates/:id/reject',
      async (req, reply) => {
        try {
          const decision = await vehicleIdentityDecisions.reject(req.params.id)
          return reply.send({ data: decision })
        } catch (err) {
          if (err instanceof NotFoundError) return reply.notFound(err.message)
          throw err
        }
      },
    )

    // ── POST /admin/vehicle-identity/candidates/:id/split ────────────────────
    // Split a verified group: transition to `split` and unlink listings.
    // Only decisions in `verified` state can be split (422 otherwise).
    app.post<{ Params: { id: string } }>(
      '/candidates/:id/split',
      async (req, reply) => {
        try {
          const decision = await vehicleIdentityDecisions.split(req.params.id)
          return reply.send({ data: decision })
        } catch (err) {
          if (err instanceof NotFoundError) return reply.notFound(err.message)
          if (err instanceof InvalidStateError) {
            return reply.code(422).send({ error: { code: 'INVALID_STATE', message: err.message } })
          }
          throw err
        }
      },
    )

    // ── POST /admin/vehicle-identity/candidates/:id/undo-split ───────────────
    // Undo a split: transition back to `candidate` so the operator can
    // re-approve or re-reject.
    app.post<{ Params: { id: string } }>(
      '/candidates/:id/undo-split',
      async (req, reply) => {
        try {
          const decision = await vehicleIdentityDecisions.undoSplit(req.params.id)
          return reply.send({ data: decision })
        } catch (err) {
          if (err instanceof NotFoundError) return reply.notFound(err.message)
          throw err
        }
      },
    )
  }
