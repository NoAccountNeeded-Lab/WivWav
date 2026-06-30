import { isValidVin, normalizeVin, checkDigitValid } from '@wivwav/db'
import { QUALITY_RULE_SEVERITY } from '@wivwav/types'
import type { ListingUpsertData } from './repositories.js'

export type ValidationSeverity = 'error' | 'warn'

/**
 * Rule families (issue #502 AC). Every ValidationIssue belongs to exactly one
 * family so operators and dashboards can filter/aggregate by category.
 *
 * - structural: card/detail text bled across fields, malformed identity keys.
 * - format: a field's value does not match its expected shape (regex/enum/type).
 * - completeness: a required or conditionally-required field is missing.
 * - plausibility: a present, well-formed value is outside a believable range.
 * - cross_field: two or more fields contradict each other.
 * - authoritative: a third-party authoritative source (NHTSA vPIC) disagrees
 *   with scraped data for the same identity field.
 * - source_drift: aggregate signal about a source's error/missing rate, not
 *   tied to one listing (emitted by summarizeQuality/sourceDrift, not validateListing).
 */
export type ValidationRuleFamily =
  | 'structural'
  | 'format'
  | 'completeness'
  | 'plausibility'
  | 'cross_field'
  | 'authoritative'
  | 'source_drift'

export interface ValidationIssue {
  field: string
  value: string
  rule: string
  family: ValidationRuleFamily
  severity: ValidationSeverity
}

export interface ListingValidationResult {
  sourceRecordKey: string
  issues: ValidationIssue[]
}

/** Decision produced from a listing's issues — the actual publication gate. */
export type PublicationDecision = {
  publicationStatus: 'eligible' | 'quarantined'
  qualityIssueCodes: string[]
}

// ─── Structural ────────────────────────────────────────────────────────────

// Patterns that indicate field-label bleed from adjacent card text with no newline separators.
// Leading \b prevents matching mid-word, but no trailing \b is required because in the bleed
// case field labels are concatenated directly with their values (e.g. "ConversionRear Entry").
const FIELD_LABEL_BLEED =
  /\b(?:Mileage|Conv\s*Make|Conversion|Location|Request\s+Information|Schedule\s+a\s+Test\s+Drive)|Stock\s*:/i

// ─── Format / range ────────────────────────────────────────────────────────

const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
])

const ZIP_RE = /^\d{5}(-\d{4})?$/
const MIN_YEAR = 1990
const MAX_FUTURE_MODEL_YEARS = 2
const MAX_PLAUSIBLE_PRICE_CENTS = 50_000_000 // $500,000 — generous ceiling for a WAV.
const MIN_PLAUSIBLE_PRICE_CENTS = 50_000 // $500 — below this is almost certainly a parse error.
const MAX_PLAUSIBLE_MILEAGE = 400_000
const MAX_PLAUSIBLE_FLOOR_LOWERING_INCHES = 14
const MAX_PLAUSIBLE_WHEELCHAIR_CAPACITY = 6
const MAX_PLAUSIBLE_IMAGE_COUNT = 60

function maxModelYear(): number {
  return new Date().getFullYear() + MAX_FUTURE_MODEL_YEARS
}

let urlOrigin: ((url: string) => string | null) = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Test-only hook so URL parsing can be exercised without depending on global URL quirks. */
export function __setUrlOriginForTest(fn: typeof urlOrigin): void {
  urlOrigin = fn
}

function isPlausibleUrl(value: string): boolean {
  return urlOrigin(value) !== null && /^https?:\/\//i.test(value)
}

// ─── Cross-field: WAV feature labels unsupported by vehicle-specific evidence ──

// Features that require corroborating evidence (a ramp/floor/conversion signal) before
// they are credible. Listing them without ANY supporting field is a fabrication signal —
// most commonly AI hallucination or boilerplate copy bleed from an unrelated template.
const ACCESSIBILITY_FEATURES_REQUIRING_EVIDENCE = new Set([
  'has_lift',
  'power_ramp',
  'kneel_system',
  'lowered_floor',
])

function push(
  issues: ValidationIssue[],
  field: string,
  value: string,
  rule: string,
  family: ValidationRuleFamily,
  severity: ValidationSeverity,
): void {
  issues.push({ field, value: value.slice(0, 120), rule, family, severity })
}

/**
 * Per-listing deterministic validation. Returns every issue found across all
 * rule families; callers decide publication using decidePublication().
 *
 * This function does NOT perform NHTSA lookups — authoritative VIN-decode
 * mismatch detection lives in vin-enrich.ts because it requires a network
 * call. validateAuthoritativeMismatch() below is the pure comparison used by
 * both that job and these tests.
 */
export function validateListing(listing: ListingUpsertData): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // ── Structural ──────────────────────────────────────────────────────────

  // sourceRecordKey is the upsert identity key — a space means the whole card text bled in.
  if (listing.sourceRecordKey.includes(' ')) {
    push(issues, 'sourceRecordKey', listing.sourceRecordKey, 'contains_space', 'structural', 'error')
  }

  const textFields: Array<[string, string | null | undefined]> = [
    ['externalId', listing.externalId],
    ['stockNumber', listing.stockNumber],
    ['color', listing.color],
    ['conversionManufacturer', listing.wav.conversionManufacturer],
    ['city', listing.location.city],
    ['state', listing.location.state],
  ]
  for (const [field, value] of textFields) {
    if (value && FIELD_LABEL_BLEED.test(value)) {
      push(issues, field, value, 'field_label_bleed', 'structural', 'warn')
    }
  }

  if (listing.location.city && /\d/.test(listing.location.city)) {
    push(issues, 'city', listing.location.city, 'contains_digits', 'structural', 'warn')
  }

  // ── Format / range ──────────────────────────────────────────────────────

  if (listing.location.state && !STATE_CODES.has(listing.location.state)) {
    push(issues, 'state', listing.location.state, 'invalid_format', 'format', 'warn')
  }

  if (listing.location.zip && !ZIP_RE.test(listing.location.zip)) {
    push(issues, 'zip', listing.location.zip, 'invalid_format', 'format', 'warn')
  }

  if (!Number.isInteger(listing.year) || listing.year < MIN_YEAR || listing.year > maxModelYear()) {
    // Distinct rule id from the warn-severity 'implausible_value' used elsewhere so
    // a rule code alone is always sufficient to recover severity (no field-specific
    // lookup needed by API filters / operator tooling).
    push(issues, 'year', String(listing.year), 'implausible_year', 'plausibility', 'error')
  }

  if (listing.priceCents != null) {
    if (listing.priceCents < 0) {
      push(issues, 'priceCents', String(listing.priceCents), 'negative_value', 'format', 'error')
    } else if (
      listing.priceCents > 0
      && (listing.priceCents < MIN_PLAUSIBLE_PRICE_CENTS || listing.priceCents > MAX_PLAUSIBLE_PRICE_CENTS)
    ) {
      // 0 is the documented "price on request" sentinel and is never flagged here.
      push(issues, 'priceCents', String(listing.priceCents), 'implausible_value', 'plausibility', 'warn')
    }
  }

  if (listing.mileage != null) {
    if (listing.mileage < 0) {
      push(issues, 'mileage', String(listing.mileage), 'negative_value', 'format', 'error')
    } else if (listing.mileage > MAX_PLAUSIBLE_MILEAGE) {
      push(issues, 'mileage', String(listing.mileage), 'implausible_value', 'plausibility', 'warn')
    } else if (listing.condition === 'new' && listing.mileage > 500) {
      // A "new" condition with substantial mileage suggests a misparsed condition or odometer field.
      push(issues, 'mileage', String(listing.mileage), 'new_with_high_mileage', 'cross_field', 'warn')
    }
  }

  if (listing.wav.floorLoweringInches != null) {
    if (listing.wav.floorLoweringInches < 0 || listing.wav.floorLoweringInches > MAX_PLAUSIBLE_FLOOR_LOWERING_INCHES) {
      push(
        issues,
        'floorLoweringInches',
        String(listing.wav.floorLoweringInches),
        'implausible_value',
        'plausibility',
        'warn',
      )
    }
  }

  if (listing.wav.wheelchairCapacity != null) {
    if (listing.wav.wheelchairCapacity < 1 || listing.wav.wheelchairCapacity > MAX_PLAUSIBLE_WHEELCHAIR_CAPACITY) {
      push(
        issues,
        'wheelchairCapacity',
        String(listing.wav.wheelchairCapacity),
        'implausible_value',
        'plausibility',
        'warn',
      )
    }
  }

  if (listing.images.length > MAX_PLAUSIBLE_IMAGE_COUNT) {
    push(issues, 'images', String(listing.images.length), 'implausible_value', 'plausibility', 'warn')
  }
  for (const image of listing.images) {
    if (!isPlausibleUrl(image)) {
      push(issues, 'images', image, 'invalid_format', 'format', 'warn')
      break // one malformed URL is enough signal; avoid flooding issues for a whole gallery.
    }
  }

  if (!isPlausibleUrl(listing.sourceUrl)) {
    // Distinct rule id from the warn-severity 'invalid_format' used for non-identity
    // URL fields — a missing/malformed sourceUrl breaks provenance entirely.
    push(issues, 'sourceUrl', listing.sourceUrl, 'malformed_source_url', 'format', 'error')
  }
  if (listing.buyerUrl && !isPlausibleUrl(listing.buyerUrl)) {
    push(issues, 'buyerUrl', listing.buyerUrl, 'invalid_format', 'format', 'warn')
  }

  // ── VIN: full normalization + check-digit, not just length/forbidden-char ──

  if (listing.vin) {
    const normalized = normalizeVin(listing.vin)
    if (!isValidVin(normalized)) {
      push(issues, 'vin', listing.vin, 'unparseable_vin', 'format', 'error')
    } else if (!checkDigitValid(normalized)) {
      // Structurally valid but fails the NA check-digit. Non-NA VINs can legitimately
      // fail this, so it is a warning, not an error — vin-enrich's NHTSA decode is the
      // authoritative confirmation step.
      push(issues, 'vin', normalized, 'invalid_check_digit', 'format', 'warn')
    }
  }

  // ── Completeness: required / conditionally-required fields ─────────────
  // Required fields differ by sellerType and source. A dealer listing without a
  // price is suspicious; a private-seller "price on request" listing (priceCents
  // null or 0) is legitimate and must not be penalized. The same applies to phone
  // numbers for private sellers (suppressed for privacy, not scraped) and to
  // descriptions ("unavailable detail" is a valid state for thin source cards).

  if (!listing.make || !listing.model) {
    // Distinct rule id from the warn-severity 'missing_required_field' used for
    // non-identity required fields — make/model absence means the listing has no
    // usable identity at all.
    push(issues, 'make_model', `${listing.make ?? ''}/${listing.model ?? ''}`, 'missing_identity_field', 'completeness', 'error')
  }

  if (listing.sellerType === 'dealer' && !listing.dealer.name) {
    push(issues, 'dealer.name', '', 'missing_required_field', 'completeness', 'warn')
  }

  if (listing.condition !== 'new' && listing.priceCents == null && listing.sellerType === 'dealer') {
    // Dealers almost always publish a price or an explicit "call for price" sentinel (0).
    // A null price on a dealer card (not private-seller, not price-on-request) is a gap.
    push(issues, 'priceCents', '', 'missing_conditional_field', 'completeness', 'warn')
  }

  // ── Cross-field consistency ──────────────────────────────────────────────

  if (listing.saleStatus === 'sold' && listing.soldAt == null) {
    push(issues, 'soldAt', '', 'sold_without_sold_at', 'cross_field', 'warn')
  }
  if ((listing.saleStatus === 'active' || listing.saleStatus === 'pending') && listing.soldAt != null) {
    push(issues, 'saleStatus', listing.saleStatus, 'active_with_sold_at', 'cross_field', 'error')
  }
  if (listing.saleStatus === 'gone' && listing.images.length > 0 && listing.description) {
    // Not an error — a "gone" detail page can still carry stale evidence — but
    // operators should be able to see when gone listings still look fully populated,
    // which often means the detail extractor misread a banner.
    push(issues, 'saleStatus', listing.saleStatus, 'gone_with_full_detail', 'cross_field', 'warn')
  }

  // WAV accessibility labels unsupported by any vehicle-specific evidence: a feature is
  // claimed but none of conversionType/rampType/floorLoweringInches/wheelchairCapacity
  // carry any corroborating signal. This catches boilerplate "Wheelchair Lift" badges
  // bled in from an unrelated template section.
  const hasCorroboratingEvidence =
    listing.wav.conversionType !== 'unknown'
    || listing.wav.rampType !== 'unknown'
    || listing.wav.floorLoweringInches != null
    || listing.wav.wheelchairCapacity != null
  if (!hasCorroboratingEvidence) {
    for (const feature of listing.wav.wavFeatures) {
      if (ACCESSIBILITY_FEATURES_REQUIRING_EVIDENCE.has(feature)) {
        push(issues, 'wavFeatures', feature, 'unsupported_accessibility_claim', 'cross_field', 'warn')
        break
      }
    }
  }

  return issues
}

// ─── Authoritative mismatch (NHTSA vPIC vs scraped identity) ────────────────

export interface DecodedVehicleIdentity {
  make: string
  model: string
  year: number
}

export interface ScrapedVehicleIdentity {
  make: string
  model: string
  year: number
}

/**
 * Pure comparison between an NHTSA vPIC VIN decode and the scraped identity
 * fields for the same listing. Used by vin-enrich.ts, which performs the
 * actual network call — kept here so the comparison logic is unit-testable
 * without mocking fetch, and so the rule lives next to the other rule
 * families for the AC's "grouped by family" requirement.
 *
 * Year mismatch tolerates a 1-year model-year/calendar-year skew (common for
 * vehicles sold near a model-year boundary). Make/model mismatches are
 * compared case-insensitively after trimming, since dealers and NHTSA use
 * different casing conventions (e.g. "Mobility" vans badged under a chassis
 * make like "Dodge" / "RAM" are NOT considered a mismatch by this function;
 * that distinction is the caller's responsibility to encode via a known-OEM
 * allowlist, not this generic comparator).
 */
export function validateAuthoritativeMismatch(
  scraped: ScrapedVehicleIdentity,
  decoded: DecodedVehicleIdentity,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const normalize = (s: string) => s.trim().toLowerCase()

  if (normalize(scraped.make) !== normalize(decoded.make)) {
    push(
      issues,
      'make',
      `scraped=${scraped.make} decoded=${decoded.make}`,
      'nhtsa_make_mismatch',
      'authoritative',
      'error',
    )
  }
  if (normalize(scraped.model) !== normalize(decoded.model)) {
    push(
      issues,
      'model',
      `scraped=${scraped.model} decoded=${decoded.model}`,
      'nhtsa_model_mismatch',
      'authoritative',
      'error',
    )
  }
  if (Math.abs(scraped.year - decoded.year) > 1) {
    push(
      issues,
      'year',
      `scraped=${scraped.year} decoded=${decoded.year}`,
      'nhtsa_year_mismatch',
      'authoritative',
      'error',
    )
  }

  return issues
}

// ─── Rule severity lookup ───────────────────────────────────────────────────

/**
 * Re-exported from @wivwav/types, which is the single source of truth so
 * apps/api's operator quarantine endpoints can filter/display by severity
 * without depending on this app. Keep this map in sync there whenever a
 * push()/issue call site above changes severity or adds a new rule id.
 */
export const RULE_SEVERITY: Readonly<Record<string, ValidationSeverity>> = QUALITY_RULE_SEVERITY

// ─── Publication decision ──────────────────────────────────────────────────

/**
 * Warning-severity rules that are explicitly allowed to publish despite the
 * warning (documented field-specific exception). Every other warning still
 * publishes by default — warnings are operator-visible signals, not gates —
 * but this set exists so a future rule can be deliberately blocking without
 * being an "error". Currently empty: no warning rule blocks publication.
 */
const WARN_RULES_THAT_BLOCK_PUBLICATION: ReadonlySet<string> = new Set([])

/**
 * Decides whether a listing may be published given its validation issues.
 *
 * - Any error-severity issue quarantines the listing individually, regardless
 *   of the source-wide systemic error rate (AC: per-listing gate, not only
 *   the aggregate threshold).
 * - Warning-severity issues remain visible to operators (qualityIssueCodes)
 *   and do not block publication unless the specific rule is listed in
 *   WARN_RULES_THAT_BLOCK_PUBLICATION.
 */
export function decidePublication(issues: ValidationIssue[]): PublicationDecision {
  const qualityIssueCodes = [...new Set(issues.map((i) => i.rule))]
  const hasError = issues.some((i) => i.severity === 'error')
  const hasBlockingWarn = issues.some((i) => i.severity === 'warn' && WARN_RULES_THAT_BLOCK_PUBLICATION.has(i.rule))

  return {
    publicationStatus: hasError || hasBlockingWarn ? 'quarantined' : 'eligible',
    qualityIssueCodes,
  }
}

// ─── Aggregate quality summary (per-run, source-drift signal) ──────────────

export interface QualitySummary {
  totalListings: number
  listingsWithIssues: number
  errorListings: number
  warnListings: number
  issuesByRule: Record<string, number>
}

export function summarizeQuality(results: ListingValidationResult[]): QualitySummary {
  const issuesByRule: Record<string, number> = {}
  let errorListings = 0
  let warnListings = 0
  let listingsWithIssues = 0

  for (const result of results) {
    if (result.issues.length === 0) continue
    listingsWithIssues++
    let hasError = false
    let hasWarn = false
    for (const issue of result.issues) {
      issuesByRule[issue.rule] = (issuesByRule[issue.rule] ?? 0) + 1
      if (issue.severity === 'error') hasError = true
      else hasWarn = true
    }
    if (hasError) errorListings++
    if (hasWarn) warnListings++
  }

  return { totalListings: results.length, listingsWithIssues, errorListings, warnListings, issuesByRule }
}

// A scrape is considered systemically dirty when more than this fraction of listings have
// error-severity issues (e.g., dirty sourceRecordKey). Systemic dirt usually means the DOM
// structure changed and the selector-based extraction is broken across the board.
export const SYSTEMIC_ERROR_THRESHOLD = 0.2

// ─── Source-level drift baseline ───────────────────────────────────────────

/**
 * How far a source's current error/missing rate may drift above its rolling
 * baseline before it is considered abrupt drift (vs. normal day-to-day noise).
 * Expressed as an absolute percentage-point delta, not a ratio, so a baseline
 * near zero does not produce an unreasonably small absolute threshold.
 */
export const DRIFT_THRESHOLD_PERCENTAGE_POINTS = 0.15

export interface SourceDriftBaseline {
  /** Exponentially-weighted rolling average error rate (0-1) observed historically. */
  baselineErrorRate: number
  /** Exponentially-weighted rolling average missing/unknown rate (0-1) observed historically. */
  baselineMissingRate: number
}

export interface SourceDriftObservation {
  errorRate: number
  missingRate: number
}

export interface SourceDriftResult {
  drifted: boolean
  reason: string | null
  /** Updated baseline to persist — an EWMA blend of the prior baseline and this run. */
  nextBaseline: SourceDriftBaseline
}

const BASELINE_SMOOTHING_FACTOR = 0.2 // weight given to the new observation each run.

/**
 * Compares a single run's observed error/missing rates against the source's
 * rolling baseline. Returns whether the run constitutes abrupt drift (which
 * callers should treat as a pause-the-source signal with a clear reason) and
 * the updated baseline to persist regardless of the outcome (an EWMA blend
 * keeps the baseline responsive to genuine, gradual shifts in source quality
 * while still detecting sudden breakage).
 */
export function detectSourceDrift(
  baseline: SourceDriftBaseline,
  observation: SourceDriftObservation,
): SourceDriftResult {
  const errorDelta = observation.errorRate - baseline.baselineErrorRate
  const missingDelta = observation.missingRate - baseline.baselineMissingRate

  const driftedOnError = errorDelta > DRIFT_THRESHOLD_PERCENTAGE_POINTS
  const driftedOnMissing = missingDelta > DRIFT_THRESHOLD_PERCENTAGE_POINTS

  const nextBaseline: SourceDriftBaseline = {
    baselineErrorRate:
      baseline.baselineErrorRate * (1 - BASELINE_SMOOTHING_FACTOR) + observation.errorRate * BASELINE_SMOOTHING_FACTOR,
    baselineMissingRate:
      baseline.baselineMissingRate * (1 - BASELINE_SMOOTHING_FACTOR) + observation.missingRate * BASELINE_SMOOTHING_FACTOR,
  }

  if (!driftedOnError && !driftedOnMissing) {
    return { drifted: false, reason: null, nextBaseline }
  }

  const parts: string[] = []
  if (driftedOnError) {
    parts.push(
      `error rate ${(observation.errorRate * 100).toFixed(1)}% vs baseline ${(baseline.baselineErrorRate * 100).toFixed(1)}%`,
    )
  }
  if (driftedOnMissing) {
    parts.push(
      `missing rate ${(observation.missingRate * 100).toFixed(1)}% vs baseline ${(baseline.baselineMissingRate * 100).toFixed(1)}%`,
    )
  }

  return {
    drifted: true,
    reason: `Source quality drifted abruptly — ${parts.join('; ')} (threshold ${(DRIFT_THRESHOLD_PERCENTAGE_POINTS * 100).toFixed(0)} pts)`,
    nextBaseline,
  }
}
