import type { ConversionType, RampType } from '@wivwav/types'
import type { PrismaClient } from '@wivwav/db'
import type { WivWavLogger } from '@wivwav/logger'
import { applyFieldResolution, recordClaim } from './claims-repository.js'
import { NoopPhotoClaimProvider } from './photo-claim-provider.js'
import { logFieldResolutionEvent } from './metrics.js'
import type { ClaimField } from './types.js'

const defaultPhotoClaimProvider = new NoopPhotoClaimProvider()

/**
 * Records an independent detail-page-derived claim (#499) for each
 * accessibility field the detail description made an identifiable claim
 * about, then recomputes that field's resolution from every stored claim
 * (card + detail + any photo evidence) and writes the result onto the
 * Listing row.
 *
 * Runs in its own transaction, separate from detail-extract.ts's main
 * update transaction, mirroring card-claims.ts. Callers should only invoke
 * this when the description was actually observed this run (evidence !==
 * 'missing') — a failed/absent detail extraction is not a claim of "no
 * accessibility evidence", so it must not silently downgrade an existing
 * resolution.
 */
export async function recordDetailFieldClaims(
  db: PrismaClient,
  listingId: string,
  detailValues: { conversionType: ConversionType; rampType: RampType },
  sourceRef: string,
  extractorVersion: string,
  photoClaimProvider = defaultPhotoClaimProvider,
  logger?: WivWavLogger,
): Promise<void> {
  const values: Record<ClaimField, string> = {
    conversionType: detailValues.conversionType,
    rampType: detailValues.rampType,
  }
  const fields: readonly ClaimField[] = ['conversionType', 'rampType']
  const observedFields = fields.filter((field) => values[field] !== 'unknown')
  if (observedFields.length === 0) return

  const observedAt = new Date()

  const logEvents = await db.$transaction(async (tx) => {
    for (const field of observedFields) {
      await recordClaim(tx, {
        listingId,
        field,
        claimedValue: values[field],
        evidenceKind: 'vehicle_text',
        sourceRef,
        observedAt,
        extractorVersion,
        confidence: null,
      })
    }

    const events = []
    for (const field of observedFields) {
      const { logEvent } = await applyFieldResolution(tx, listingId, field, photoClaimProvider)
      if (logEvent) events.push(logEvent)
    }
    return events
  })

  for (const event of logEvents) logFieldResolutionEvent(event, logger)
}
