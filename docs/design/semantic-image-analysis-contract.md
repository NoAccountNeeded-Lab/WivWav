# Semantic image analysis contract (#796)

Design decision for #129 (AI-assisted image understanding for listing
photos). This document is the gate: #797 (ramp-photo evidence candidate),
#798 (queue/backfill), #799 (API read model), and the shopper-facing web
slices (#800–#802) implement against it. It contains no schema migrations
or runtime code.

## Relationship to #503

#503 already shipped image integrity infrastructure: `ListingImage`
(`exactHash`, `pHash`, `analysisVersion`) and `ImageCluster`
(`crossVehicle`, `isPlaceholder`, `analysisVersion`) — see
`packages/db/prisma/schema.prisma`. That `analysisVersion` versions the
hash/clustering pipeline only.

Semantic analysis is a distinct concern with its own invalidation domain:
a prompt or taxonomy change should not force re-hashing, and a hashing
algorithm change should not force re-running the model. This contract
introduces a separate field, `semanticAnalysisVersion` (see below),
rather than reusing `ListingImage.analysisVersion`.

## Provider/model adapter boundary

Reuse the shape already established for text completion
(`packages/agents/src/provider.ts`'s `CompletionProvider`, implemented by
`apps/scraper/src/ai/ollama-provider.ts`), extended for image input rather
than inventing a new pattern:

```ts
export interface ImageAnalysisProvider {
  readonly name: string
  analyze(input: {
    imageBytes: Uint8Array
    contentType: string
    schemaVersion: string
  }): Promise<ImageAnalysisResult> // see "Result shape" below
}
```

- Vendor lock-in lives behind this interface only; call sites (the #797
  vertical slice, the #798 queue worker) depend on `ImageAnalysisProvider`,
  never on a specific vendor SDK.
- **Local-dev / CI provider:** a `NoopImageAnalysisProvider` (mirroring
  `NoopPhotoClaimProvider` in `apps/scraper/src/resolution/photo-claim-provider.ts`)
  that returns an empty label/claim set. Production wiring selects a real
  provider via config; tests inject a stub, the same pattern
  `PhotoClaimProvider` already uses to let #499's resolver be exercised
  ahead of #129 landing.
- Provider selection (which vendor, which model) is deploy configuration,
  not part of this contract — this contract only fixes the interface
  shape and the local-dev fallback behavior.

## Image transfer method: bounded fetch, never direct CDN URL to the provider

Fetch image bytes server-side and send bytes (not the source CDN URL) to
the model provider. Do not hand the provider a source-image URL to fetch
itself.

Reuses the existing bounded-download primitive from #503's
`apps/scraper/src/images/image-hasher.ts` (`MAX_IMAGE_BYTES` = 10 MiB,
`DEFAULT_FETCH_TIMEOUT_MS` = 10s) rather than a new fetch path — one
image byte range is downloaded once and used for both hashing and
semantic analysis where both run in the same pass.

Rationale, consistent with #503's stated privacy/licensing posture
(`image-integrity-backfill.ts`'s header comment: "Raw image bytes and
pixel data are discarded immediately after hashing. No images are
proxied, stored, or re-served."):

- Handing a third-party model vendor a direct source CDN URL leaks the
  existence and access pattern of scraped listing photos to that vendor's
  own infrastructure, and is a second, uncontrolled point of contact with
  the source's servers beyond WivWav's own scraping.
  A single bounded server-side fetch keeps WivWav as the only party that
  ever contacts the source, matching how hashing already works.
- Raw bytes are held only in memory for the duration of the analysis
  call and discarded immediately after — never written to disk or DB,
  never proxied or re-served. Only the structured result (below) is
  persisted.

## Eligible image scope

Scoped from #503's integrity-eligible set. An image is eligible for
semantic analysis when:

- `ListingImage.kind === 'vehicle_photo'` (excludes `placeholder`,
  `site_chrome`, `excluded`).
- Its `ImageCluster` (if any) has `isPlaceholder === false` and
  `crossVehicle === false`.
- The bounded download succeeds (within `MAX_IMAGE_BYTES` /
  `DEFAULT_FETCH_TIMEOUT_MS`); failed downloads are skipped, not retried
  inline.

The cluster half of this (`isPlaceholder`/`crossVehicle`) reuses
`isImageEligibleForClaims` from
`apps/scraper/src/resolution/photo-claim-provider.ts` unchanged — the
same gate #499 already defined for photo evidence in general applies
here too. That function does **not** check `ListingImage.kind` today (it
only inspects the image's cluster, and returns `eligible: true` for any
image with no cluster regardless of kind) — the `kind === 'vehicle_photo'`
filter above is new logic #797 must add before or alongside calling
`isImageEligibleForClaims`, not something the existing function already
covers. Do not assume kind-filtering is free from reusing that function.

## Run scope, budget, and rate limits

- **Per-listing cap:** this contract sets a new limit, not derived from
  any existing configuration — analyze at most 8 images per listing per
  run, enough to cover the taxonomy's evidence categories (ramp, lift,
  odometer, VIN plate, hand controls, cabin, exterior, damage) without
  unbounded spend on listings with 50+ photos. Prioritize by position
  (first 8 gallery images) until #801's hero/category signals can reorder
  the priority list.
- **Backfill throughput:** the #798 queue must enforce its own global
  concurrency limit and inter-request delay — there is no existing
  throttling pattern in this codebase to reuse (`completion-provider.ts`
  is a bare re-export with no rate-limiting, and none of its current
  consumers throttle calls). #798 defines and tunes these numbers against
  the chosen provider's rate limits; this contract only requires that
  some bound exists, not what it is.
- **Retention of provider inputs/outputs:** the model provider does not
  retain image bytes on WivWav's side (bytes are never persisted, per
  above). The structured result is retained indefinitely as the
  evidence/audit record (append-only, per #499's evidence model), subject
  to whatever data-lifecycle policy #505's gold-dataset/retention work
  establishes for the rest of the evidence graph.

## Label/claim taxonomy

A controlled enum, not free text, distinct from the AI's optional
free-text `summary`/`altText` fields (which remain unconstrained prose
for accessibility/UI use, not for claim resolution):

```ts
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
```

Only labels in this enum may back a `FieldClaim` (see Result shape).
Extending the taxonomy requires updating this list and bumping
`semanticAnalysisVersion`'s meaning is unaffected — the taxonomy version
is tracked by the schema version passed to the provider (see below), not
by the row-level version field.

## Per-claim confidence and result shape

`apps/scraper/src/resolution/types.ts`'s `FieldClaim`/`NewFieldClaim`
already models confidence per-claim (`confidence: number | null`) rather
than one scalar per image — the semantic provider's output must produce
one entry per asserted label, each independently confident, not a single
`aiConfidence` covering the whole image:

```ts
export interface ImageAnalysisResult {
  /** Provider/schema version that produced this result. */
  schemaVersion: string
  /** Free-text, unconstrained — for accessibility alt text / UI display only. */
  altText: string | null
  summary: string | null
  /** Zero or more controlled-taxonomy labels, each independently confident. */
  labels: Array<{
    label: ImageLabel
    confidence: number // 0-1
  }>
  /** Populated only for labels that map to a resolver-governed field (ramp/lift → rampType, etc). */
  fieldClaims: Array<{
    field: ClaimField // from apps/scraper/src/resolution/types.ts — 'conversionType' | 'rampType' initially
    claimedValue: string
    confidence: number
  }>
}
```

`fieldClaims` entries are the ones #797 turns into `NewFieldClaim` rows
with `evidenceKind: 'photo'`, `extractorVersion` (a `string`) set to the
stringified `semanticAnalysisVersion` value (not `ListingImage.analysisVersion`), routed
through `isImageEligibleForClaims` before being recorded — exactly the
seam `photo-claim-provider.ts`'s doc comment already describes as
pending on #129.

## Semantic-analysis version field

Add `ListingImage.semanticAnalysisVersion: Int?` (nullable — distinct
from the existing non-null `analysisVersion`, which stays scoped to
hash/clustering) in the migration #797 ships. `null` means "not yet
semantically analyzed"; a set value is the taxonomy/prompt schema
version that produced the stored result, so a taxonomy change can force
re-analysis of stale rows (`WHERE semanticAnalysisVersion < currentVersion
OR semanticAnalysisVersion IS NULL`) independent of #503's hash pipeline
version.

## Calibration/threshold gates before shopper visibility

No semantic result reaches shoppers (web/API) before both:

1. **Calibration evidence exists** — a manually-reviewed sample (reusing
   #505's gold-dataset/audit machinery once it lands, or a smaller ad hoc
   sample if #797 ships first) establishing a confidence threshold per
   label above which precision is acceptable for public display.
2. **The API read model (#799) enforces that threshold at read time** —
   "allowlisted, threshold-passing evidence only," per #799's own scope —
   so a confidence bar can be raised later without a backfill.

Until both hold, semantic results are internal-only: visible to
operators (ops UI, once built) and to the #499 resolver as
`eligible: true/false` claims, never rendered in `apps/web`.

## Privacy/copyright posture

- WivWav does not own the photographed vehicles or, in most cases, the
  photographs themselves — they are sourced from third-party listing
  pages under whatever terms govern each source (the same posture #503
  already operates under; see `image-integrity-backfill.ts`'s header
  comment, "Operators are responsible for ensuring their scraping
  activity complies with each source's ToS").
- Sending image bytes to an external model provider for classification is
  an additional third-party disclosure beyond scraping-for-display. It is
  covered by the same "operators are responsible for source ToS
  compliance" posture, extended to also require that the chosen model
  provider's own terms permit receiving and processing third-party
  images for this purpose (no assumption that every vendor's terms allow
  this — verify per provider before wiring one in).
- No raw image bytes are retained after the analysis call (matches
  #503's existing "discarded immediately after hashing" behavior).
- Only structured, low-dimensional output (labels, confidence, short
  free text) is retained — never a re-hosted copy of the image, never
  bytes.
- `altText`/`summary` free text is model-generated commentary about the
  image, not a reproduction of it, and is treated as WivWav-authored
  metadata for accessibility purposes.

## Acceptance criteria mapping

- Contract document: this file.
- Privacy/copyright posture: section above.
- Reviewed by worker + reviewer roles: tracked in #796's issue comments.
