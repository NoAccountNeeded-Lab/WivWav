import type { FastifyPluginAsync } from 'fastify'
import type { PrismaClient } from '@wivwav/db'

interface Options {
  db: PrismaClient
}

const STATUSES = ['pending_review', 'approved', 'rejected'] as const
type Status = (typeof STATUSES)[number]
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/**
 * #1178 read-only listing of collected dealer site candidates, most-cited
 * first. Approval UI and status changes belong to #1111.
 *
 * GET /internal/ops/dealer-site-candidates?status=pending_review&limit=100
 */
export const internalOpsDealerSiteCandidatesRoutes: FastifyPluginAsync<Options> = async (app, { db }) => {
  app.get<{ Querystring: { status?: string; limit?: string } }>('/', async (req, reply) => {
    const { status, limit: rawLimit } = req.query
    if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
      return reply.badRequest(`status must be one of: ${STATUSES.join(', ')}`)
    }
    const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return reply.badRequest(`limit must be an integer between 1 and ${MAX_LIMIT}`)
    }
    const candidates = await db.dealerSiteCandidate.findMany({
      where: status === undefined ? {} : { status: status as Status },
      include: { _count: { select: { listings: true } } },
      orderBy: [{ listings: { _count: 'desc' } }, { origin: 'asc' }],
      take: limit,
    })
    return reply.send({
      data: candidates.map(({ _count, ...candidate }) => ({ ...candidate, listingCount: _count.listings })),
    })
  })
}
