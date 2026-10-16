import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { Prisma, PrismaClient } from '@wivwav/db'
import type { QueueAdapter, QueueFactory } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'

interface Options {
  db: PrismaClient
  queueFactory: QueueFactory
}

const ACTIONS = ['requeue-resolve', 'hide', 'unhide', 'mark-gone', 'release-quarantine'] as const
type Action = (typeof ACTIONS)[number]

type Outcome =
  | { kind: 'applied' | 'noop'; message: string; enqueue: boolean }
  | { kind: 'conflict'; message: string }

const applied = (message: string, enqueue = false): Outcome => ({ kind: 'applied', message, enqueue })
const noop = (message: string): Outcome => ({ kind: 'noop', message, enqueue: false })
const conflict = (message: string): Outcome => ({ kind: 'conflict', message })
const bad = (code: string, message: string) => ({ error: { code, message } })

/**
 * #1157 per-listing operator actions. Audit entries are `listing_observation`
 * rows with stage `ops_action` (no lifecycle trail exists yet, #1072), written in
 * the same transaction as the mutation, including no-op and refused attempts.
 * Every state change is a conditional UPDATE, so a concurrent hide is never
 * overwritten. Unknown ids cannot be audited (the row has a listing foreign
 * key); they are logged instead.
 *
 * requeue-vin-decode is deliberately absent: vin-enrich has no per-listing
 * variant, and clearing a lock to force a batch can steal a live claim.
 */
export const internalOpsListingActionsRoutes: FastifyPluginAsync<Options> = async (app, { db, queueFactory }) => {
  const resolveQueue: QueueAdapter = queueFactory.createQueue(QUEUES.LISTING_RESOLVE)

  // POST /internal/ops/listings/:id/actions  { action, reason? }
  app.post<{ Params: { id: string }; Body: unknown }>('/:id/actions', async (req, reply) => {
    const { id } = req.params
    const body = req.body
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send(bad('INVALID_BODY', 'body must be a JSON object'))
    }
    const { action: rawAction, reason: rawReason } = body as { action?: unknown; reason?: unknown }
    if (typeof rawAction !== 'string' || !(ACTIONS as readonly string[]).includes(rawAction)) {
      return reply.code(400).send(bad('INVALID_ACTION', `action must be one of: ${ACTIONS.join(', ')}`))
    }
    if (rawReason !== undefined && typeof rawReason !== 'string') {
      return reply.code(400).send(bad('INVALID_REASON', 'reason must be a string'))
    }
    const action = rawAction as Action
    const reason = (rawReason ?? '').trim()
    if (reason.length > 500 || (action === 'hide' && reason.length === 0)) {
      return reply.code(400).send(bad('INVALID_REASON', 'hide requires a reason of 1-500 characters'))
    }
    const actor = String(req.headers['x-ops-actor'] ?? 'internal-api-secret').slice(0, 200)
    const ref = randomUUID()

    const result = await db.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id },
        select: { status: true, publicationStatus: true, manuallyHiddenAt: true },
      })
      if (!listing) return null
      const hidden = listing.manuallyHiddenAt !== null

      let outcome: Outcome
      switch (action) {
        case 'requeue-resolve':
          outcome = listing.status === 'gone' ? conflict('Listing is gone; nothing to resolve')
            : hidden ? conflict('Listing is hidden; unhide it first')
            : applied('Queued listing-resolve', true)
          break
        case 'hide': {
          const r = await tx.listing.updateMany({
            where: { id, manuallyHiddenAt: null },
            data: { manuallyHiddenAt: new Date(), manualHideReason: reason, publicationStatus: 'quarantined' },
          })
          outcome = r.count > 0 ? applied('Hidden; leaves search on the next index poll') : noop('Already hidden')
          break
        }
        case 'unhide': {
          const r = await tx.listing.updateMany({
            where: { id, manuallyHiddenAt: { not: null } },
            data: { manuallyHiddenAt: null, manualHideReason: null, publicationStatus: 'pending', qualityIssueCodes: [], qualityCheckedAt: null },
          })
          outcome = r.count > 0 ? applied('Unhidden; queued listing-resolve to republish', true) : noop('Not hidden')
          break
        }
        case 'mark-gone': {
          const r = await tx.listing.updateMany({ where: { id, status: { not: 'gone' } }, data: { status: 'gone', goneAt: new Date() } })
          outcome = r.count > 0 ? applied('Marked gone') : noop('Already gone')
          break
        }
        case 'release-quarantine': {
          if (hidden) { outcome = conflict('Listing is hidden; unhide it instead'); break }
          const r = await tx.listing.updateMany({
            where: { id, manuallyHiddenAt: null, publicationStatus: 'quarantined' },
            data: { publicationStatus: 'pending', qualityIssueCodes: [], qualityCheckedAt: null },
          })
          outcome = r.count > 0 ? applied('Released; queued listing-resolve', true)
            : conflict(`Listing is ${listing.publicationStatus}, not quarantined`)
          break
        }
      }

      await tx.listingObservation.create({
        data: {
          listingId: id,
          stage: 'ops_action',
          reference: ref,
          extractionVersion: 'ops-action-v1',
          changedFields: [action],
          before: { status: listing.status, publicationStatus: listing.publicationStatus, hidden },
          after: { action, reason: reason || null, actor, result: outcome.kind, detail: outcome.message },
        } satisfies Prisma.ListingObservationUncheckedCreateInput,
      })
      return outcome
    })

    if (!result) {
      req.log.warn({ listingId: id, action, actor }, 'ops listing action on unknown listing')
      return reply.notFound(`Listing "${id}" not found`)
    }
    if (result.kind === 'conflict') {
      return reply.code(409).send(bad('LISTING_STATE_CONFLICT', result.message))
    }

    let jobId: string | null = null
    if (result.enqueue) {
      try {
        // Per-attempt id: a fixed id would hand back an old completed job instead of rerunning.
        jobId = await resolveQueue.add({ listingId: id, observationReference: `ops:${ref}` }, { jobId: `ops-resolve-${id}-${ref}` })
      } catch (err) {
        await db.listingObservation.create({
          data: {
            listingId: id,
            stage: 'ops_action',
            reference: `${ref}:enqueue-failed`,
            extractionVersion: 'ops-action-v1',
            changedFields: [action],
            before: {},
            after: { action, actor, result: 'enqueue_failed', detail: err instanceof Error ? err.message : String(err) },
          },
        })
        return reply.code(502).send(bad('ENQUEUE_FAILED', 'The change was saved but queueing listing-resolve failed; retry requeue-resolve'))
      }
    }
    return reply.send({ data: { id, action, changed: result.kind === 'applied', jobId, message: result.message } })
  })
}
