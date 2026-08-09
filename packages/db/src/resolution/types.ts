/**
 * Shared types for the #499 claim/evidence resolution model.
 *
 * `ClaimField` and `EvidenceKind` are TypeScript unions, not Prisma enums —
 * `ListingFieldClaim.field`/`evidenceKind` are plain strings in the schema so
 * the resolver can extend to another field without a migration (see
 * packages/db/prisma/schema.prisma). These unions are the single source of
 * truth for the currently-supported values; validate against them at every
 * write boundary (claims-repository.ts).
 */

/** Listing fields currently governed by claim/evidence resolution. */
export type ClaimField = 'conversionType' | 'rampType'

/**
 * Provenance category for one piece of evidence. Determines resolver
 * precedence (see resolver.ts):
 *  - `authoritative_source` — dealer build sheet or conversion-product
 *    record naming this specific vehicle. May establish a value alone.
 *  - `structured_source` — the source's own structured field or listing
 *    category (e.g. a card's "conversion" facet).
 *  - `vehicle_text` — vehicle-specific title/detail free text.
 *  - `photo` — photo-derived evidence, consumed via PhotoClaimProvider.
 *    Never eligible alone; also excluded when reused/stock or low-confidence.
 *  - `generic_text` — boilerplate/marketing copy not specific to this
 *    vehicle. Never eligible evidence (recorded only for audit, if at all).
 */
export type EvidenceKind =
  | 'structured_source'
  | 'vehicle_text'
  | 'authoritative_source'
  | 'photo'
  | 'generic_text'

/** One evidence-backed assertion about a listing field's value. */
export interface FieldClaim {
  listingId: string
  field: ClaimField
  claimedValue: string
  evidenceKind: EvidenceKind
  sourceRef: string | null
  observedAt: Date
  extractorVersion: string
  confidence: number | null
  /**
   * False when this claim is retained for audit but excluded from
   * resolution — e.g. a photo matched to a reused/stock image cluster.
   * Distinct from evidence-kind-based ineligibility (generic_text, low-
   * confidence photo), which the resolver applies itself.
   */
  eligible: boolean
  ineligibleReason?: string | null
}

/** Input to `recordClaim` — a claim not yet persisted. */
export type NewFieldClaim = Omit<FieldClaim, 'eligible'> & { eligible?: boolean }

export type FieldResolutionState = 'verified' | 'source_reported' | 'conflicting' | 'unknown'

export interface ResolvedField {
  /** Normalized value to write to the Listing row. `unknown` unless verified/source_reported. */
  value: string
  state: FieldResolutionState
  /** Populated only when state === 'conflicting': the disagreeing claims. */
  conflictingClaims: FieldClaim[]
}
