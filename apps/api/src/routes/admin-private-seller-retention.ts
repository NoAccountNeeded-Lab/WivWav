import type { FastifyPluginAsync } from 'fastify'
import type { PrismaClient } from '@wivwav/db'
import type { Meilisearch } from 'meilisearch'
import { appendPrivateSellerDeletionAuditEntry, listPrivateSellerDeletionAuditEntries } from '@wivwav/db'
import {
  anonymizePrivateSellerListing,
  ListingNotFoundError,
  NotPrivateSellerError,
} from '../services/private-seller-retention.js'

interface AdminPrivateSellerRetentionPluginOptions {
  db: PrismaClient
  meili: Meilisearch
}

interface DeletionRequestBody {
  reason?: string
  requestedBy?: string
}

/**
 * #817 operator-facing deletion-request workflow for private-seller
 * listings — the manual counterpart to the scheduled retention sweep
 * (apps/api/src/jobs/private-seller-retention.ts). Both share
 * `anonymizePrivateSellerListing`, so the deletion contract (which fields
 * get cleared, what happens to images/raw-page evidence/the search index)
 * is identical whether a listing was reached by the automated sweep or by
 * an operator acting on a seller's request.
 *
 * Guarded by adminAuthPlugin at the /admin prefix (see app.ts) — every
 * route here requires `Authorization: Bearer {INTERNAL_API_SECRET}`.
 */
export const adminPrivateSellerRetentionRoutes: FastifyPluginAsync<AdminPrivateSellerRetentionPluginOptions> =
  async (app, { db, meili }) => {
    // ── POST /admin/private-seller-retention/listings/:id/delete ─────────────
    // Immediately anonymizes one private-seller listing regardless of its
    // gone/retention-window status — an explicit operator action, e.g. in
    // response to a seller's request at privacy@wivwav.com. Records an
    // audit entry on both success and failure so a failure can be
    // investigated and retried (by the operator, or by the next scheduled
    // sweep once the listing eventually goes gone and ages past the window).
    app.post<{ Params: { id: string }; Body: DeletionRequestBody | null }>(
      '/listings/:id/delete',
      async (req, reply) => {
        const listingId = req.params.id
        const reason = req.body?.reason?.trim() || null
        const requestedBy = req.body?.requestedBy?.trim() || null

        try {
          const result = await anonymizePrivateSellerListing(db, meili, listingId)
          await appendPrivateSellerDeletionAuditEntry(db, listingId, {
            action: 'operator-request',
            outcome: result.outcome,
            fieldsCleared: result.fieldsCleared,
            reason,
            requestedBy,
          })
          return reply.send({ data: result })
        } catch (err) {
          if (err instanceof ListingNotFoundError) return reply.notFound(err.message)
          if (err instanceof NotPrivateSellerError) {
            return reply.code(422).send({ error: { code: 'NOT_PRIVATE_SELLER', message: err.message } })
          }

          const errorMessage = err instanceof Error ? err.message : String(err)
          await appendPrivateSellerDeletionAuditEntry(db, listingId, {
            action: 'operator-request',
            outcome: 'failed',
            fieldsCleared: [],
            reason,
            requestedBy,
            errorMessage,
          }).catch(() => {})
          throw err
        }
      },
    )

    // ── GET /admin/private-seller-retention/listings/:id/audit ───────────────
    // Full deletion-lifecycle history for one listing — evidence for both
    // automated sweeps and operator-initiated requests, newest first.
    app.get<{ Params: { id: string } }>('/listings/:id/audit', async (req, reply) => {
      const entries = await listPrivateSellerDeletionAuditEntries(db, req.params.id)
      return reply.send({ data: entries })
    })
  }
