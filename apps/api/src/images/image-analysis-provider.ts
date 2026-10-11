/**
 * Provider adapter boundary for semantic image analysis (#796/#797).
 *
 * Reuses the shape already established for text completion
 * (`CompletionProvider` in `@wivwav/agents`, implemented by
 * `ai/ollama-provider.ts`), extended for image input.
 * Vendor lock-in lives behind `ImageAnalysisProvider` only — call sites
 * (the #797 vertical slice, the future #798 queue worker) depend on this
 * interface, never on a specific vendor SDK.
 *
 * See `docs/design/semantic-image-analysis-contract.md` for the full
 * design decision this implements.
 */

import type { ClaimField } from '../resolution/types.js'

/**
 * Controlled taxonomy of photo-evidence labels a provider may assert. Only
 * labels in this enum may back a `fieldClaims` entry. Distinct from the
 * optional free-text `summary`/`altText` fields, which remain unconstrained
 * prose for accessibility/UI use, not for claim resolution.
 */
export type ImageLabel =
  | 'exterior'
  | 'interior'
  | 'ramp'
  | 'lift'
  | 'lowered_floor'
  | 'tie_downs'
  | 'hand_controls'
  | 'transfer_seat'
  | 'odometer'
  | 'vin_plate'
  | 'window_sticker'
  | 'damage'
  | 'dealer_branding'

export const IMAGE_LABELS: readonly ImageLabel[] = [
  'exterior',
  'interior',
  'ramp',
  'lift',
  'lowered_floor',
  'tie_downs',
  'hand_controls',
  'transfer_seat',
  'odometer',
  'vin_plate',
  'window_sticker',
  'damage',
  'dealer_branding',
]

export const VIEW_ANGLES = ['front', 'rear', 'side', 'interior', 'detail', 'other'] as const
export type ViewAngle = (typeof VIEW_ANGLES)[number]
export const PHOTO_QUALITIES = ['good', 'poor', 'watermark_or_placeholder'] as const
export type PhotoQuality = (typeof PHOTO_QUALITIES)[number]

/**
 * Extra, cheap-to-ask details used for local evaluation (#1112). Not part of
 * the stored contract: `validateImageAnalysisResult` does not carry them, so
 * persisting them needs a schema change that is a separate decision.
 */
export interface ImageAnalysisExtras {
  color: string | null
  conversionManufacturer: string | null
  viewAngle: ViewAngle | null
  photoQuality: PhotoQuality | null
}

export interface ImageAnalysisInput {
  imageBytes: Uint8Array
  contentType: string
  /** Prompt/taxonomy schema version to request from the provider. */
  schemaVersion: string
}

export interface ImageAnalysisResult {
  /** Provider/schema version that produced this result. */
  schemaVersion: string
  /** Free-text, unconstrained — for accessibility alt text / UI display only. */
  altText: string | null
  summary: string | null
  /** Zero or more controlled-taxonomy labels, each independently confident. */
  labels: Array<{ label: ImageLabel; confidence: number }>
  /** Populated only for labels that map to a resolver-governed field (ramp/lift → rampType, etc). */
  fieldClaims: Array<{ field: ClaimField; claimedValue: string; confidence: number }>
  /** Optional extras from providers that ask for them; never persisted. */
  extras?: ImageAnalysisExtras
}

/** What one provider call consumed, when the provider can report it. */
export interface AnalysisUsage {
  /** Model the provider actually used (may differ from the configured one). */
  model: string | null
  /** API-equivalent cost reported by the provider; null when it reports none. */
  costUsd: number | null
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  durationMs: number | null
}

export interface ImageAnalysisProvider {
  readonly name: string
  /** Model identifier this provider reports (for audit); null if none. */
  readonly model: string | null
  analyze(input: ImageAnalysisInput): Promise<ImageAnalysisResult>
  /** Usage of the most recent `analyze` call, for providers that can report it. */
  getLastUsage?(): AnalysisUsage | null
  /**
   * Analyzes several photos (of one listing) in a single call, returning one
   * result per input in order. Optional: callers fall back to `analyze`.
   */
  analyzeBatch?(inputs: ImageAnalysisInput[]): Promise<ImageAnalysisResult[]>
}

/**
 * Default provider: asserts no labels or claims. Safe until a real
 * classifier is wired in (mirrors `NoopPhotoClaimProvider` in
 * `resolution/photo-claim-provider.ts`).
 */
export class NoopImageAnalysisProvider implements ImageAnalysisProvider {
  readonly name = 'noop'
  readonly model = null

  async analyze(input: ImageAnalysisInput): Promise<ImageAnalysisResult> {
    return {
      schemaVersion: input.schemaVersion,
      altText: null,
      summary: null,
      labels: [],
      fieldClaims: [],
    }
  }
}
