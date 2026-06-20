import type { ListingUpsertData } from './repositories.js'

export type ValidationSeverity = 'error' | 'warn'

export interface ValidationIssue {
  field: string
  value: string
  rule: string
  severity: ValidationSeverity
}

export interface ListingValidationResult {
  sourceRecordKey: string
  issues: ValidationIssue[]
}

// Patterns that indicate field-label bleed from adjacent card text with no newline separators.
// Leading \b prevents matching mid-word, but no trailing \b is required because in the bleed
// case field labels are concatenated directly with their values (e.g. "ConversionRear Entry").
const FIELD_LABEL_BLEED =
  /\b(?:Mileage|Conv\s*Make|Conversion|Location|Request\s+Information|Schedule\s+a\s+Test\s+Drive)|Stock\s*:/i

export function validateListing(listing: ListingUpsertData): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // sourceRecordKey is the upsert identity key — a space means the whole card text bled in.
  if (listing.sourceRecordKey.includes(' ')) {
    issues.push({
      field: 'sourceRecordKey',
      value: listing.sourceRecordKey.slice(0, 120),
      rule: 'contains_space',
      severity: 'error',
    })
  }

  // Any text field containing a field label keyword has bleed from adjacent card text.
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
      issues.push({ field, value: value.slice(0, 120), rule: 'field_label_bleed', severity: 'warn' })
    }
  }

  // city should not contain digits (stock numbers, postal codes).
  if (listing.location.city && /\d/.test(listing.location.city)) {
    issues.push({
      field: 'city',
      value: listing.location.city.slice(0, 120),
      rule: 'contains_digits',
      severity: 'warn',
    })
  }

  // state must be a two-letter ISO code when present.
  if (listing.location.state && !/^[A-Z]{2}$/.test(listing.location.state)) {
    issues.push({
      field: 'state',
      value: listing.location.state,
      rule: 'invalid_format',
      severity: 'warn',
    })
  }

  return issues
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

// A scrape is considered systemically dirty when more than this fraction of listings have
// error-severity issues (e.g., dirty sourceRecordKey). Systemic dirt usually means the DOM
// structure changed and the selector-based extraction is broken across the board.
export const SYSTEMIC_ERROR_THRESHOLD = 0.2
