import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { PrismaClient } from '@wivwav/db'
import type { QueueAdapter, QueueFactory } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'

interface Options {
  db: PrismaClient
  queueFactory: QueueFactory
}

const ACTIONS = ['requeue-resolve', 'requeue-vin-decode', 'hide', 'unhide', 'mark-gone', 'release-quarantine'] as const
type Action = (typeof ACTIONS)[number]

interface Body {
  action?: string
  reason?: string
}

interface Outcome {
  changed: boolean
  jobId?: string
  note: string
}

const conflict = (message: string) => ({ conflict: message }) as const

/**
 * #1157 per-listing operator actions. Audit entries are `listing_observation`
 * rows with stage `ops_action` (no lifecycle trail exists yet, #1072), one per
 * request, including no-op and refused ones so every attempt is traceable.
 */
export const internalOpsListingActionsRoutes: FastifyPluginAsync<Options> = async (app, { db, queueFactory }) => {
  const resolveQueue: QueueAdapter = queueFactory.createQueue(QUEUES.LISTING_RESOLVE)
  const vinQueue: QueueAdapter = queueFactory.createQueue(QUEUES.VIN_ENRICH)

  const enqueueResolve = (listingId: string, ref: string) =>
    resolveQueue.add({ listingId, observationReference: ref }, { jobId: `ops-resolve-${listingId}` })

  // POST /internal/ops/listings/:id/actions  { action, reason? }
  app.post<{ Params: { id: string }; Body: Body }>('/:id/actions', async (req, reply) => {
    const { id } = req.params
    const action = req.body?.action as Action | undefined
    const reason = req.body?.reason?.trim() ?? ''
    if (!action || !ACTIONS.includes(action)) {
      return reply.code(400).send({ error: { code: 'INVALID_ACTION', message: `action must be one of: ${ACTIONS.join(', ')}` } })
    }
    if (action === 'hide' && (reason.length === 0 || reason.length > 500)) {
      return reply.code(400).send({ error: { code: 'INVALID_REASON', message: 'hide requires a reason of 1-500 characters' } })
    }

    const listing = await db.listing.findUnique({
      where: { id },
      select: { id: true, status: true, publicationStatus: true, manuallyHiddenAt: true, vin: true, vehicleModelId: true },
    })
    if (!listing) return reply.notFound(`Listing "${id}" not found`)

    const ref = randomUUID()
    const hidden = listing.manuallyHiddenAt !== null
    const before = { status: listing.status, publicationStatus: listing.publicationStatus, hidden }

    let outcome: Outcome | ReturnType<typeof conflict>
    switch (action) {
      case 'requeue-resolve':
        if (listing.status === 'gone') outcome = conflict('Listing is gone; nothing to resolve')
        else if (hidden) outcome = conflict('Listing is hidden; unhide it first')
        else outcome = { changed: true, jobId: await enqueueResolve(id, `ops:${ref}`), note: 'Queued listing-resolve' }
        break
      case 'requeue-vin-decode':
        // ponytail: vin-enrich has no per-listing variant; this queues the shared batch job
        // (it claims any listing with a VIN and no vehicle model, id order). Add a listingId claim to target one.
        if (!listing.vin) outcome = conflict('Listing has no VIN')
        else if (listing.vehicleModelId) outcome = conflict('VIN is already decoded')
        else {
          await db.listing.update({ where: { id }, data: { processingLockedAt: null } })
          outcome = { changed: true, jobId: await vinQueue.add({}, { jobId: 'ops-vin-enrich' }), note: 'Queued vin-enrich batch job (not limited to this listing)' }
        }
        break
      case 'hide':
        if (hidden) outcome = { changed: false, note: 'Already hidden' }
        else {
          await db.listing.update({
            where: { id },
            data: { manuallyHiddenAt: new Date(), manualHideReason: reason, publicationStatus: 'quarantined' },
          })
          outcome = { changed: true, note: 'Hidden; leaves search on the next index poll' }
        }
        break
      case 'unhide':
        if (!hidden) outcome = { changed: false, note: 'Not hidden' }
        else {
          await db.listing.update({
            where: { id },
            data: { manuallyHiddenAt: null, manualHideReason: null, publicationStatus: 'pending', qualityIssueCodes: [], qualityCheckedAt: null },
          })
          outcome = { changed: true, jobId: await enqueueResolve(id, `ops:${ref}`), note: 'Unhidden; queued listing-resolve to republish' }
        }
        break
      case 'mark-gone':
        if (listing.status === 'gone') outcome = { changed: false, note: 'Already gone' }
        else {
          await db.listing.update({ where: { id }, data: { status: 'gone', goneAt: new Date() } })
          outcome = { changed: true, note: 'Marked gone' }
        }
        break
      case 'release-quarantine':
        if (hidden) outcome = conflict('Listing is hidden; unhide it instead')
        else if (listing.publicationStatus !== 'quarantined') outcome = conflict(`Listing is ${listing.publicationStatus}, not quarantined`)
        else {
          await db.listing.update({
            where: { id },
            data: { publicationStatus: 'pending', qualityIssueCodes: [], qualityCheckedAt: null },
          })
          outcome = { changed: true, jobId: await enqueueResolve(id, `ops:${ref}`), note: 'Released; queued listing-resolve' }
        }
        break
    }

    const result = outcome
    await db.listingObservation.create({
      data: {
        listingId: id,
        stage: 'ops_action',
        reference: ref,
        extractionVersion: 'ops-action-v1',
        changedFields: [action],
        before,
        after: {
          action,
          reason: reason || null,
          actor: String(req.headers['x-ops-actor'] ?? 'internal-api-secret'),
          result: 'conflict' in result ? 'refused' : result.changed ? 'applied' : 'noop',
          detail: 'conflict' in result ? result.conflict : result.note,
          jobId: 'conflict' in result ? null : (result.jobId ?? null),
        },
      },
    })

    if ('conflict' in result) return reply.code(409).send({ error: { code: 'LISTING_STATE_CONFLICT', message: result.conflict } })
    return reply.send({ data: { id, action, changed: result.changed, jobId: result.jobId ?? null, message: result.note } })
  })
}
