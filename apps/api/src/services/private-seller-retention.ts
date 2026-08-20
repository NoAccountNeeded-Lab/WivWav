import type { PrismaClient } from '@wivwav/db'
import type { Meilisearch } from 'meilisearch'
import { syncListings } from '@wivwav/search'

/**
 * #817 private-seller retention/deletion lifecycle.
 *
 * A gone private-seller listing keeps sensitive fields (phone, description,
 * ZIP, images) indefinitely until this module anonymizes it. Both the
 * scheduled sweep (apps/api/src/jobs/private-seller-retention.ts) and the
 * operator-initiated deletion-request route
 * (apps/api/src/routes/admin-private-seller-retention.ts) call
 * `anonymizePrivateSellerListing` — the single place that defines the
 * deletion contract across PostgreSQL, Meilisearch, and raw-page evidence.
 *
 * Retention period: a gone private-seller listing is anonymized
 * `RETENTION_DAYS` days after `goneAt` by the scheduled sweep. An operator's
 * explicit deletion request bypasses the `goneAt`/`status` gate entirely
 * (a seller can ask for removal at any time) but still only applies to
 * `sellerType: 'private'` listings — dealer listings are out of scope for
 * this policy and are not personal data.
 *
 * Idempotency: `Listing.retentionAppliedAt` is the sole marker. Once set,
 * repeat calls are a no-op (`outcome: 'skipped-already-applied'`) — this is
 * what makes the scheduled sweep safe to run on an overlapping/re-queried
 * candidate set every tick, and what makes it safe for an operator to submit
 * the same deletion request twice.
 */

export const RETENTION_DAYS = 30

/** Fields nulled/cleared on the Listing row. Also the value recorded as `fieldsCleared` in the audit trail. */
export const RETENTION_CLEARED_FIELDS = [
  'dealerPhone',
  'dealerName',
  'description',
  'zip',
  'images',
  'cardImages',
] as const

export class ListingNotFoundError extends Error {
  constructor(listingId: string) {
    super(`Listing "${listingId}" not found`)
    this.name = 'ListingNotFoundError'
  }
}

export class NotPrivateSellerError extends Error {
  constructor(listingId: string) {
    super(`Listing "${listingId}" is not a private-seller listing`)
    this.name = 'NotPrivateSellerError'
  }
}

export interface AnonymizeResult {
  listingId: string
  outcome: 'applied' | 'skipped-already-applied'
  fieldsCleared: string[]
  imagesDeleted: number
  rawPagesDeleted: number
}

/**
 * Returns the cutoff below which a gone private-seller listing's `goneAt`
 * makes it eligible for the automated sweep.
 */
export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * Anonymizes one private-seller listing: clears sensitive PostgreSQL fields,
 * deletes stored image references and raw-page evidence, and removes the
 * listing from the Meilisearch index (best-effort — see below).
 *
 * Does NOT check `status`/`goneAt` — callers that mean "only gone listings
 * past the retention window" (the scheduled sweep) apply that filter to the
 * candidate query themselves; this function is the shared mutation, not the
 * eligibility policy, so the operator deletion-request path can call it
 * directly on any private-seller listing regardless of lifecycle state.
 *
 * Fail-closed by construction: the PostgreSQL mutation and the raw-page /
 * image-reference cleanup happen inside one transaction, so a failure
 * partway through leaves `retentionAppliedAt` unset and the row unchanged —
 * the next sweep or operator retry re-attempts the whole thing rather than
 * leaving a half-anonymized row. The Meilisearch removal happens after that
 * transaction commits and is best-effort: a gone listing is already
 * `status: 'gone'` (never `active`/`eligible`), so it is not published even
 * if this call fails, and apps/api/src/jobs/search-indexer-poll.ts's
 * checkpointed poller will pick up this row's bumped `updatedAt` and retry
 * the removal on its next tick regardless.
 */
export async function anonymizePrivateSellerListing(
  db: PrismaClient,
  meili: Meilisearch,
  listingId: string,
): Promise<AnonymizeResult> {
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: { id: true, sellerType: true, sourceUrl: true, buyerUrl: true, retentionAppliedAt: true },
  })
  if (!listing) throw new ListingNotFoundError(listingId)
  if (listing.sellerType !== 'private') throw new NotPrivateSellerError(listingId)

  if (listing.retentionAppliedAt !== null) {
    return {
      listingId,
      outcome: 'skipped-already-applied',
      fieldsCleared: [],
      imagesDeleted: 0,
      rawPagesDeleted: 0,
    }
  }

  // RawPage has no listingId FK — it's matched by URL (see the model comment
  // in packages/db/prisma/schema.prisma). `RawPage.url` is `@unique`, so this
  // targets exactly the scraped page(s) for this listing's own sourceUrl/
  // buyerUrl and cannot delete evidence belonging to a different listing.
  const rawPageUrls = [...new Set([listing.sourceUrl, listing.buyerUrl].filter((url): url is string => Boolean(url)))]

  const [, imageDeleteResult, rawPageDeleteResult] = await db.$transaction([
    db.listingImageSemanticAnalysis.deleteMany({ where: { listingImage: { listingId } } }),
    db.listingImage.deleteMany({ where: { listingId } }),
    db.rawPage.deleteMany({ where: { url: { in: rawPageUrls } } }),
    db.listing.update({
      where: { id: listingId },
      data: {
        dealerPhone: null,
        dealerName: null,
        description: null,
        zip: null,
        images: [],
        cardImages: [],
        retentionAppliedAt: new Date(),
      },
    }),
  ])
  const imagesDeleted = imageDeleteResult.count
  const rawPagesDeleted = rawPageDeleteResult.count

  try {
    await syncListings([listingId], db, meili)
  } catch (err) {
    // Non-fatal — see the fail-closed note above. The next search-indexer
    // poll tick self-heals since the transaction above already bumped
    // `updatedAt` via the listing update.
    void err
  }

  return {
    listingId,
    outcome: 'applied',
    fieldsCleared: [...RETENTION_CLEARED_FIELDS],
    imagesDeleted,
    rawPagesDeleted,
  }
}
