/**
 * semantic-image-analysis — first executable slice of #796/#797's
 * semantic image understanding: run one `ImageAnalysisProvider` call
 * against an eligible listing image and persist the attempt as an
 * append-only `ListingImageSemanticAnalysis` row.
 *
 * This module never reads from or writes to any `Listing` ramp-type (or
 * other WAV) field — it only records evidence. Turning `fieldClaims` into
 * `ListingFieldClaim` rows and feeding the #499 resolver is out of scope
 * for this slice (tracked separately); the raw claims from the provider
 * are stored on the analysis row for that future use.
 *
 * Idempotency: re-running analysis for the same `(listingImageId,
 * contentHash, semanticAnalysisVersion)` is a no-op — the unique
 * constraint on that triple, combined with an upsert, guarantees at most
 * one stored row per attempt regardless of how many times it is re-run or
 * raced concurrently. If a row already exists, the provider is not called
 * again.
 *
 * Never throws: provider failures and malformed provider responses are
 * both recorded as a `status: 'error'` row rather than propagated, so a
 * single bad response can't crash a batch run. No confidence or label is
 * ever fabricated for an error row.
 */

import type { Prisma, PrismaClient, ListingImageSemanticAnalysis } from '@wivwav/db'
import type { ClaimField } from '../resolution/types.js'
import { IMAGE_LABELS } from './image-analysis-provider.js'
import type { ImageAnalysisProvider, ImageAnalysisResult, ImageLabel } from './image-analysis-provider.js'

/** Transaction/client type this module writes through — mirrors claims-repository.ts. */
export type SemanticAnalysisTx = PrismaClient | Prisma.TransactionClient

/** Current taxonomy/prompt schema version. Bump when the taxonomy or prompt changes. */
export const CURRENT_SEMANTIC_ANALYSIS_VERSION = 1

const CLAIM_FIELDS: readonly ClaimField[] = ['conversionType', 'rampType']

export interface AnalyzeListingImageInput {
  listingImageId: string
  /** SHA-256 of the analyzed image bytes (e.g. `image-hasher.ts`'s `exactHash`). */
  contentHash: string
  imageBytes: Uint8Array
  contentType: string
  /** Defaults to `CURRENT_SEMANTIC_ANALYSIS_VERSION`. */
  semanticAnalysisVersion?: number
}

function isFiniteConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isImageLabel(value: unknown): value is ImageLabel {
  return typeof value === 'string' && (IMAGE_LABELS as readonly string[]).includes(value)
}

function isClaimField(value: unknown): value is ClaimField {
  return typeof value === 'string' && (CLAIM_FIELDS as readonly string[]).includes(value)
}

/**
 * Validates a provider's raw response against `ImageAnalysisResult`'s
 * contract. Returns `null` (rather than throwing) when the shape is
 * malformed, so callers can record a failure row without an unhandled
 * error — a provider is untrusted input, not a type guarantee.
 */
export function validateImageAnalysisResult(raw: unknown): ImageAnalysisResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>

  if (typeof value['schemaVersion'] !== 'string' || value['schemaVersion'].length === 0) return null
  if (value['altText'] !== null && typeof value['altText'] !== 'string') return null
  if (value['summary'] !== null && typeof value['summary'] !== 'string') return null

  const labelsRaw = value['labels']
  if (!Array.isArray(labelsRaw)) return null
  const labels: ImageAnalysisResult['labels'] = []
  for (const entry of labelsRaw) {
    if (typeof entry !== 'object' || entry === null) return null
    const e = entry as Record<string, unknown>
    if (!isImageLabel(e['label']) || !isFiniteConfidence(e['confidence'])) return null
    labels.push({ label: e['label'], confidence: e['confidence'] })
  }

  const fieldClaimsRaw = value['fieldClaims']
  if (!Array.isArray(fieldClaimsRaw)) return null
  const fieldClaims: ImageAnalysisResult['fieldClaims'] = []
  for (const entry of fieldClaimsRaw) {
    if (typeof entry !== 'object' || entry === null) return null
    const e = entry as Record<string, unknown>
    if (!isClaimField(e['field'])) return null
    if (typeof e['claimedValue'] !== 'string' || e['claimedValue'].length === 0) return null
    if (!isFiniteConfidence(e['confidence'])) return null
    fieldClaims.push({ field: e['field'], claimedValue: e['claimedValue'], confidence: e['confidence'] })
  }

  return {
    schemaVersion: value['schemaVersion'],
    altText: (value['altText'] as string | null) ?? null,
    summary: (value['summary'] as string | null) ?? null,
    labels,
    fieldClaims,
  }
}

/**
 * Runs `provider.analyze()` against one image (unless an attempt already
 * exists for this content hash + semantic version) and persists the
 * outcome. Always returns the stored row; never throws.
 */
export async function analyzeListingImage(
  db: SemanticAnalysisTx,
  provider: ImageAnalysisProvider,
  input: AnalyzeListingImageInput,
): Promise<ListingImageSemanticAnalysis> {
  const semanticAnalysisVersion = input.semanticAnalysisVersion ?? CURRENT_SEMANTIC_ANALYSIS_VERSION

  const key = {
    listingImageId_contentHash_semanticAnalysisVersion: {
      listingImageId: input.listingImageId,
      contentHash: input.contentHash,
      semanticAnalysisVersion,
    },
  }

  const existing = await db.listingImageSemanticAnalysis.findUnique({ where: key })
  if (existing) return existing

  let outcome:
    | { status: 'success'; result: ImageAnalysisResult }
    | { status: 'error'; errorCode: string; errorMessage: string }

  try {
    const raw = await provider.analyze({
      imageBytes: input.imageBytes,
      contentType: input.contentType,
      schemaVersion: String(semanticAnalysisVersion),
    })
    const validated = validateImageAnalysisResult(raw)
    outcome =
      validated !== null
        ? { status: 'success', result: validated }
        : { status: 'error', errorCode: 'malformed_response', errorMessage: 'Provider response failed schema validation' }
  } catch (err) {
    outcome = {
      status: 'error',
      errorCode: 'provider_error',
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }

  const baseData = {
    contentHash: input.contentHash,
    semanticAnalysisVersion,
    provider: provider.name,
    model: provider.model,
    status: outcome.status,
  }

  const data =
    outcome.status === 'success'
      ? {
          ...baseData,
          schemaVersion: outcome.result.schemaVersion,
          errorCode: null,
          errorMessage: null,
          labels: outcome.result.labels,
          fieldClaims: outcome.result.fieldClaims,
          altText: outcome.result.altText,
          summary: outcome.result.summary,
        }
      : {
          ...baseData,
          schemaVersion: String(semanticAnalysisVersion),
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
          labels: [],
          fieldClaims: [],
          altText: null,
          summary: null,
        }

  const row = await db.listingImageSemanticAnalysis.upsert({
    where: key,
    create: {
      listingImageId: input.listingImageId,
      ...data,
    },
    // Another concurrent call may have already inserted this exact
    // (listingImageId, contentHash, semanticAnalysisVersion) row between
    // the `findUnique` above and this upsert — leave it untouched rather
    // than overwriting a legitimate first-writer result.
    update: {},
  })

  if (outcome.status === 'success') {
    await db.listingImage.update({
      where: { id: input.listingImageId },
      data: { semanticAnalysisVersion },
    })
  }

  return row
}
