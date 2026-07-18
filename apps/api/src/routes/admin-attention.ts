import type { FastifyPluginAsync } from 'fastify'
import type { AttentionResourceInput, AttentionSnapshotRequest } from '@wivwav/types'
import { computeAttentionSnapshot } from '../domain/attention-snapshot.js'

const RESOURCE_KEYS = ['health', 'queues', 'sources', 'runs', 'schedules'] as const

/**
 * POST /admin/attention-snapshot
 *
 * Runs the shared domain-level "what is currently wrong" computation
 * (`computeAttentionSnapshot`, issue #774) over resource state the ops
 * overview has already fetched and polled client-side (E5: independent
 * per-section streaming/retry). The ops app posts its current
 * health/queues/sources/runs/schedules state rather than this route
 * re-fetching it, so the per-resource loading/error UX ops already tracks
 * is not duplicated or raced against a second, server-side fetch.
 */
export const adminAttentionRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: unknown }>('/', async (req, reply) => {
    const body = req.body

    if (!isRecord(body) || typeof body.now !== 'string') {
      return reply.badRequest('Request body must include a "now" ISO timestamp string')
    }

    for (const key of RESOURCE_KEYS) {
      if (!isResourceInput(body[key])) {
        return reply.badRequest(`Request body must include a "${key}" resource with { data, unavailable }`)
      }
    }

    const snapshot = computeAttentionSnapshot(body as unknown as AttentionSnapshotRequest)
    return reply.send({ data: snapshot })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isResourceInput(value: unknown): value is AttentionResourceInput<unknown> {
  return isRecord(value) && 'data' in value && typeof value.unavailable === 'boolean'
}
