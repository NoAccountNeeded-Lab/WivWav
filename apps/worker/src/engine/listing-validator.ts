import { QUALITY_RULE_SEVERITY } from '@wivwav/types'
import { checkDigitValid, isValidVin, normalizeVin } from '../lib/vin.js'
import type { ListingUpsertData } from './repositories.js'

/**
 * Ported unchanged from `apps/scraper/src/engine/listing-validator.ts`
 * (#952), except for the VIN helper import — see `../lib/vin.ts`'s
 * docstring for why that one import had to change.
 */

export type ValidationSeverity = 'error' | 'warn'

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

export type PublicationDecision = {
  publicationStatus: 'eligible' | 'quarantined'
  qualityIssueCodes: string[]
}

const FIELD_LABEL_BLEED =
  /\b(?:Mileage|Conv\s*Make|Conversion|Location|Request\s+Information|Schedule\s+a\s+Test\s+Drive)|Stock\s*:/i

const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
])

const ZIP_RE = /^\d{5}(-\d{4})?$/
const MIN_YEAR = 1990
const MAX_FUTURE_MODEL_YEARS = 2
const MAX_PLAUSIBLE_PRICE_CENTS = 50_000_000
const MIN_PLAUSIBLE_PRICE_CENTS = 50_000
const MAX_PLAUSIBLE_MILEAGE = 400_000
const MAX_PLAUSIBLE_FLOOR_LOWERING_INCHES = 14
const MAX_PLAUSIBLE_WHEELCHAIR_CAPACITY = 6
const MAX_PLAUSIBLE_IMAGE_COUNT = 60

function maxModelYear(): number {
  return new Date().getFullYear() + MAX_FUTURE_MODEL_YEARS
}

let urlOrigin: (url: string) => string | null = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function __setUrlOriginForTest(fn: typeof urlOrigin): void {
  urlOrigin = fn
}

function isPlausibleUrl(value: string): boolean {
  return urlOrigin(value) !== null && /^https?:\/\//i.test(value)
}

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

export function validateListing(listing: ListingUpsertData): ValidationIssue[] {
  const issues: ValidationIssue[] = []

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

  if (listing.location.state && !STATE_CODES.has(listing.location.state)) {
    push(issues, 'state', listing.location.state, 'invalid_format', 'format', 'warn')
  }

  if (listing.location.zip && !ZIP_RE.test(listing.location.zip)) {
    push(issues, 'zip', listing.location.zip, 'invalid_format', 'format', 'warn')
  }

  if (!Number.isInteger(listing.year) || listing.year < MIN_YEAR || listing.year > maxModelYear()) {
    push(issues, 'year', String(listing.year), 'implausible_year', 'plausibility', 'error')
  }

  if (listing.priceCents != null) {
    if (listing.priceCents < 0) {
      push(issues, 'priceCents', String(listing.priceCents), 'negative_value', 'format', 'error')
    } else if (
      listing.priceCents > 0
      && (listing.priceCents < MIN_PLAUSIBLE_PRICE_CENTS || listing.priceCents > MAX_PLAUSIBLE_PRICE_CENTS)
    ) {
      push(issues, 'priceCents', String(listing.priceCents), 'implausible_value', 'plausibility', 'warn')
    }
  }

  if (listing.mileage != null) {
    if (listing.mileage < 0) {
      push(issues, 'mileage', String(listing.mileage), 'negative_value', 'format', 'error')
    } else if (listing.mileage > MAX_PLAUSIBLE_MILEAGE) {
      push(issues, 'mileage', String(listing.mileage), 'implausible_value', 'plausibility', 'warn')
    } else if (listing.condition === 'new' && listing.mileage > 500) {
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
      break
    }
  }

  if (!isPlausibleUrl(listing.sourceUrl)) {
    push(issues, 'sourceUrl', listing.sourceUrl, 'malformed_source_url', 'format', 'error')
  }
  if (listing.buyerUrl && !isPlausibleUrl(listing.buyerUrl)) {
    push(issues, 'buyerUrl', listing.buyerUrl, 'invalid_format', 'format', 'warn')
  }

  if (listing.vin) {
    const normalized = normalizeVin(listing.vin)
    if (!isValidVin(normalized)) {
      push(issues, 'vin', listing.vin, 'unparseable_vin', 'format', 'error')
    } else if (!checkDigitValid(normalized)) {
      push(issues, 'vin', normalized, 'invalid_check_digit', 'format', 'warn')
    }
  }

  if (!listing.make || !listing.model) {
    push(issues, 'make_model', `${listing.make ?? ''}/${listing.model ?? ''}`, 'missing_identity_field', 'completeness', 'error')
  }

  if (listing.sellerType === 'dealer' && !listing.dealer.name) {
    push(issues, 'dealer.name', '', 'missing_required_field', 'completeness', 'warn')
  }

  if (listing.condition !== 'new' && listing.priceCents == null && listing.sellerType === 'dealer') {
    push(issues, 'priceCents', '', 'missing_conditional_field', 'completeness', 'warn')
  }

  if (listing.saleStatus === 'sold' && listing.soldAt == null) {
    push(issues, 'soldAt', '', 'sold_without_sold_at', 'cross_field', 'warn')
  }
  if ((listing.saleStatus === 'active' || listing.saleStatus === 'pending') && listing.soldAt != null) {
    push(issues, 'saleStatus', listing.saleStatus, 'active_with_sold_at', 'cross_field', 'error')
  }
  if (listing.saleStatus === 'gone' && listing.images.length > 0 && listing.description) {
    push(issues, 'saleStatus', listing.saleStatus, 'gone_with_full_detail', 'cross_field', 'warn')
  }

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
// Ported unchanged from apps/scraper/src/engine/listing-validator.ts (#963) —
// the vin-enrich handler's pure comparison between a vPIC VIN decode and the
// scraped identity fields for the same listing.

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

export const RULE_SEVERITY: Readonly<Record<string, ValidationSeverity>> = QUALITY_RULE_SEVERITY

const WARN_RULES_THAT_BLOCK_PUBLICATION: ReadonlySet<string> = new Set([
  'unsupported_accessibility_claim',
])

export function decidePublication(issues: ValidationIssue[]): PublicationDecision {
  const qualityIssueCodes = [...new Set(issues.map((i) => i.rule))]
  const hasError = issues.some((i) => i.severity === 'error')
  const hasBlockingWarn = issues.some((i) => i.severity === 'warn' && WARN_RULES_THAT_BLOCK_PUBLICATION.has(i.rule))

  return {
    publicationStatus: hasError || hasBlockingWarn ? 'quarantined' : 'eligible',
    qualityIssueCodes,
  }
}

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

export const SYSTEMIC_ERROR_THRESHOLD = 0.2

export const DRIFT_THRESHOLD_PERCENTAGE_POINTS = 0.15

export interface SourceDriftBaseline {
  baselineErrorRate: number
  baselineMissingRate: number
}

export interface SourceDriftObservation {
  errorRate: number
  missingRate: number
}

export interface SourceDriftResult {
  drifted: boolean
  reason: string | null
  nextBaseline: SourceDriftBaseline
}

const BASELINE_SMOOTHING_FACTOR = 0.2

export function detectSourceDrift(
  baseline: SourceDriftBaseline | null,
  observation: SourceDriftObservation,
): SourceDriftResult {
  if (baseline == null) {
    return {
      drifted: false,
      reason: null,
      nextBaseline: { baselineErrorRate: observation.errorRate, baselineMissingRate: observation.missingRate },
    }
  }

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
