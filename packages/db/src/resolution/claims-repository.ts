import type { Prisma } from '../generated/prisma/index.js'
import { resolveField } from './resolver.js'
import type { PhotoClaimProvider } from './photo-claim-provider.js'
import { buildFieldUpdateData } from './listing-update.js'
import type { ClaimField, FieldClaim, NewFieldClaim, ResolvedField } from './types.js'

/** Transaction/client type this module writes through — mirrors listing-ingest.ts. */
export type ClaimsTx = Prisma.TransactionClient

type ClaimRow = {
  listingId: string
  field: string
  claimedValue: string
  evidenceKind: string
  sourceRef: string | null
  observedAt: Date
  extractorVersion: string
  confidence: number | null
  eligible: boolean
  ineligibleReason: string | null
}

function toFieldClaim(row: ClaimRow): FieldClaim {
  return {
    listingId: row.listingId,
    field: row.field as ClaimField,
    claimedValue: row.claimedValue,
    evidenceKind: row.evidenceKind as FieldClaim['evidenceKind'],
    sourceRef: row.sourceRef,
    observedAt: row.observedAt,
    extractorVersion: row.extractorVersion,
    confidence: row.confidence,
    eligible: row.eligible,
    ineligibleReason: row.ineligibleReason,
  }
}

/**
 * Appends one claim, unless it is identical (same claimedValue, confidence,
 * eligibility) to the latest existing claim in its (listingId, field,
 * evidenceKind, sourceRef) slot — in which case it is skipped, so re-running
 * extraction against an unchanged observation never creates a duplicate row.
 * A genuinely new value/confidence for the same slot always inserts a new
 * row rather than overwriting, preserving the prior claim for audit.
 *
 * The read-then-write is not a single atomic statement — an append-only
 * history table has no natural unique key to upsert against (a later claim
 * for the same slot is a legitimate new row, not a conflict). Two
 * transactions racing to record the *same* slot at the *same* instant could
 * otherwise both pass the `findFirst` check and each insert a row. A
 * Postgres transaction-scoped advisory lock, keyed by the slot, serializes
 * that narrow race: the second transaction blocks here until the first
 * commits (releasing the lock), then its own `findFirst` sees the first
 * transaction's new row and correctly dedupes against it.
 */
export async function recordClaim(tx: ClaimsTx, claim: NewFieldClaim): Promise<void> {
  const lockKey = `listing_field_claim:${claim.listingId}:${claim.field}:${claim.evidenceKind}:${claim.sourceRef ?? ''}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

  const latest = await tx.listingFieldClaim.findFirst({
    where: {
      listingId: claim.listingId,
      field: claim.field,
      evidenceKind: claim.evidenceKind,
      sourceRef: claim.sourceRef,
    },
    orderBy: { observedAt: 'desc' },
  })

  const eligible = claim.eligible ?? true
  if (
    latest &&
    latest.claimedValue === claim.claimedValue &&
    latest.confidence === claim.confidence &&
    latest.eligible === eligible &&
    latest.ineligibleReason === (claim.ineligibleReason ?? null)
  ) {
    return
  }

  await tx.listingFieldClaim.create({
    data: {
      listingId: claim.listingId,
      field: claim.field,
      claimedValue: claim.claimedValue,
      evidenceKind: claim.evidenceKind,
      sourceRef: claim.sourceRef,
      observedAt: claim.observedAt,
      extractorVersion: claim.extractorVersion,
      confidence: claim.confidence,
      eligible,
      ineligibleReason: claim.ineligibleReason ?? null,
    },
  })
}

/** Every stored claim for one (listingId, field) pair, newest first. */
export async function getClaimsForListing(
  tx: ClaimsTx,
  listingId: string,
  field: ClaimField,
): Promise<FieldClaim[]> {
  const rows = await tx.listingFieldClaim.findMany({
    where: { listingId, field },
    orderBy: { observedAt: 'desc' },
  })
  return rows.map(toFieldClaim)
}

export interface FieldResolutionResult extends ResolvedField {
  field: ClaimField
  /** True when this resolution's state differs from `previousState`. */
  stateChanged: boolean
  previousState: ResolvedField['state']
}

/**
 * Recomputes resolution for one field from every currently-stored claim
 * (including any photo claims `photoClaimProvider` supplies) and returns the
 * result — it does not itself write to the Listing row; callers apply
 * `{ value, state }` alongside whatever else they are already updating in
 * the same transaction (see listing-resolve.ts).
 */
export async function resolveListingField(
  tx: ClaimsTx,
  listingId: string,
  field: ClaimField,
  photoClaimProvider: PhotoClaimProvider,
  previousState: ResolvedField['state'] = 'unknown',
): Promise<FieldResolutionResult> {
  const stored = await getClaimsForListing(tx, listingId, field)
  const photoClaims = await photoClaimProvider.getClaims(listingId, field)
  const merged = [
    ...stored,
    ...photoClaims.map((c): FieldClaim => ({
      ...c,
      eligible: c.eligible ?? true,
      ineligibleReason: c.ineligibleReason ?? null,
    })),
  ]

  const resolved = resolveField(merged)
  return {
    field,
    ...resolved,
    previousState,
    stateChanged: resolved.state !== previousState,
  }
}

async function readPreviousResolutionState(
  tx: ClaimsTx,
  listingId: string,
  field: ClaimField,
): Promise<ResolvedField['state']> {
  if (field === 'conversionType') {
    const row = await tx.listing.findUnique({
      where: { id: listingId },
      select: { conversionTypeResolution: true },
    })
    return row?.conversionTypeResolution ?? 'unknown'
  }
  const row = await tx.listing.findUnique({
    where: { id: listingId },
    select: { rampTypeResolution: true },
  })
  return row?.rampTypeResolution ?? 'unknown'
}

export interface FieldResolutionLogEvent {
  event: 'field-resolution.conflict-detected' | 'field-resolution.conflict-resolved'
  listingId: string
  field: ClaimField
  previousState: ResolvedField['state']
  state: ResolvedField['state']
  competingValues?: string[]
}

/**
 * Reads the listing's current resolution state for `field`, recomputes it
 * from every stored (+ photo-provided) claim, and writes `{ value, state }`
 * back onto the Listing row in the same transaction. Returns a structured
 * log event exactly when the field newly entered or newly left `conflicting`
 * — callers pass this to their logger (never the claim values themselves, to
 * avoid leaking private-seller description text into metrics/logs).
 */
export async function applyFieldResolution(
  tx: ClaimsTx,
  listingId: string,
  field: ClaimField,
  photoClaimProvider: PhotoClaimProvider,
): Promise<{ result: FieldResolutionResult; logEvent: FieldResolutionLogEvent | null }> {
  const previousState = await readPreviousResolutionState(tx, listingId, field)
  const result = await resolveListingField(tx, listingId, field, photoClaimProvider, previousState)

  await tx.listing.update({
    where: { id: listingId },
    data: buildFieldUpdateData(field, result),
  })

  let logEvent: FieldResolutionLogEvent | null = null
  if (result.stateChanged && result.state === 'conflicting') {
    logEvent = {
      event: 'field-resolution.conflict-detected',
      listingId,
      field,
      previousState,
      state: result.state,
      competingValues: [...new Set(result.conflictingClaims.map((c) => c.claimedValue))],
    }
  } else if (result.stateChanged && previousState === 'conflicting') {
    logEvent = {
      event: 'field-resolution.conflict-resolved',
      listingId,
      field,
      previousState,
      state: result.state,
    }
  }

  return { result, logEvent }
}
