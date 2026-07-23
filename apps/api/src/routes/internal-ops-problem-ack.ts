import type { FastifyPluginAsync } from 'fastify'
import type { OpsProblemStateRepository } from '../repositories/index.js'

interface InternalOpsProblemAckPluginOptions {
  problemStates: OpsProblemStateRepository
}

interface AckRequestBody {
  fingerprint?: unknown
  acknowledged?: unknown
  acknowledgedBy?: unknown
}

export const internalOpsProblemAckRoutes: FastifyPluginAsync<InternalOpsProblemAckPluginOptions> = async (
  app,
  { problemStates },
) => {
  app.post<{ Body: AckRequestBody }>('/', async (req, reply) => {
    const { fingerprint, acknowledged, acknowledgedBy } = req.body ?? {}

    if (typeof fingerprint !== 'string' || fingerprint.trim() === '') {
      return reply.badRequest('Request body must include a non-empty "fingerprint" string')
    }

    if (typeof acknowledged !== 'boolean') {
      return reply.badRequest('Request body must include an "acknowledged" boolean')
    }

    if (acknowledgedBy !== undefined && acknowledgedBy !== null && typeof acknowledgedBy !== 'string') {
      return reply.badRequest('"acknowledgedBy" must be a string when provided')
    }

    const row = await problemStates.setAcknowledgement({
      fingerprint,
      acknowledged,
      acknowledgedBy: typeof acknowledgedBy === 'string' && acknowledgedBy.trim() !== ''
        ? acknowledgedBy
        : null,
    })

    if (!row) {
      return reply.notFound('Problem fingerprint not found')
    }

    return reply.send({ data: row })
  })
}
