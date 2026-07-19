import type { PrismaClient } from '@wivwav/db'
import type { WivWavLogger } from '@wivwav/logger'
import type { ListingUpsertData } from '../engine/repositories.js'
import { applyFieldResolution, recordClaim } from './claims-repository.js'
import { NoopPhotoClaimProvider } from './photo-claim-provider.js'
import { logFieldResolutionEvent } from './metrics.js'
import type { ClaimField } from './types.js'
import { withTransientRetry } from '../lib/db-retry.js'

export const CARD_CLAIM_EXTRACTOR_VERSION = 'source-card-v1'

const CARD_CLAIM_FIELDS: readonly ClaimField[] = ['conversionType', 'rampType']

const defaultPhotoClaimProvider = new NoopPhotoClaimProvider()

/**
 * Records an independent card/category-derived claim (#499) for each
 * accessibility field the card observed a real value for, then recomputes
 * that field's resolution from every stored claim and writes the result
 * (`{ conversionType, conversionTypeResolution }` / `{ rampType,
 * rampTypeResolution }`) onto the Listing row.
 *
 * Runs in its own transaction, deliberately separate from `ingestListing`'s
 * upsert/diff transaction (`PrismaListingRepository.upsert`) — a listing
 * whose card supplied no accessibility evidence this scrape (`'unknown'`,
 * the common case: most sources only expose conversionType and BLVD's card
 * never exposes rampType at all) never touches ListingFieldClaim, matching
 * the existing card absence-sentinel convention in listing-ingest.ts where
 * a placeholder value means "no evidence", not "value is unknown".
 */
export async function recordCardFieldClaims(
  db: PrismaClient,
  listingId: string,
  listing: ListingUpsertData,
  photoClaimProvider = defaultPhotoClaimProvider,
  logger?: WivWavLogger,
): Promise<void> {
  const cardValues: Record<ClaimField, string> = {
    conversionType: listing.wav.conversionType,
    rampType: listing.wav.rampType,
  }
  const observedFields = CARD_CLAIM_FIELDS.filter((field) => cardValues[field] !== 'unknown')
  if (observedFields.length === 0) return

  const observedAt = new Date()

  // A wider timeout than Prisma's 5s default: recordClaim's pg_advisory_xact_lock
  // can legitimately block while a peer transaction on the same slot holds the
  // lock, and a lock wait that outlasts the default gets the interactive
  // transaction force-closed, surfacing as "Transaction not found" on the next
  // query inside it. withTransientRetry catches that (and other transient
  // failures) and retries the whole transaction, which recordClaim's dedup
  // check makes safe to redo.
  const logEvents = await withTransientRetry(() => db.$transaction(async (tx) => {
    for (const field of observedFields) {
      await recordClaim(tx, {
        listingId,
        field,
        claimedValue: cardValues[field],
        evidenceKind: 'structured_source',
        sourceRef: listing.sourceUrl,
        observedAt,
        extractorVersion: CARD_CLAIM_EXTRACTOR_VERSION,
        confidence: null,
      })
    }

    const events = []
    for (const field of observedFields) {
      const { logEvent } = await applyFieldResolution(tx, listingId, field, photoClaimProvider)
      if (logEvent) events.push(logEvent)
    }
    return events
  }, { timeout: 10000 }))

  for (const event of logEvents) logFieldResolutionEvent(event, logger)
}
