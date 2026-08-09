import type { Prisma } from '../generated/prisma/index.js'
import type { ConversionType, RampType } from '@wivwav/types'
import type { ClaimField, ResolvedField } from './types.js'

/**
 * Builds the type-safe `Listing` update payload for one resolved field.
 * `ClaimField` is a plain string union (see types.ts) so the resolver stays
 * reusable, but the Prisma `Listing` columns it writes to are typed enums —
 * this is the one place that bridges the two, keeping every caller
 * (card-claims.ts, detail-claims.ts, listing-resolve.ts) from re-deriving
 * the same `field === 'conversionType' ? … : …` branch.
 */
export function buildFieldUpdateData(
  field: ClaimField,
  resolved: Pick<ResolvedField, 'value' | 'state'>,
): Prisma.ListingUpdateInput {
  if (field === 'conversionType') {
    return {
      conversionType: resolved.value as ConversionType,
      conversionTypeResolution: resolved.state,
    }
  }
  return {
    rampType: resolved.value as RampType,
    rampTypeResolution: resolved.state,
  }
}
