import { checkDigitValid, isValidVin, normalizeVin } from '@wivwav/db'

/**
 * Non-VIN candidate matching (issue #529, split from #504).
 *
 * Most duplicate listings across or within sources have no VIN, or a VIN that
 * fails validation, but still share strong identity signals: a stable
 * dealer/stock-number pair, the same source URL, matching make/model/year/trim,
 * mileage/price within tolerance, the same location, and (when supplied by the
 * image-integrity pipeline, #503) trusted image-hash evidence.
 *
 * A false merge is worse than a visible duplicate, so this matcher is
 * deliberately conservative:
 *
 *   1. Negative-evidence gate runs first and is absolute — a conflicting valid
 *      VIN, an incompatible make/model/year, or an explicit cross-vehicle image
 *      conflict (as determined by the image-integrity pipeline, never inferred
 *      here from a lack of overlap) blocks auto-linking outright, regardless of
 *      how strong any other signal is.
 *   2. Stable-identifier exact matches (same dealer + same stock number, or an
 *      identical source URL) auto-link — these are matches WivWav considers
 *      effectively certain.
 *   3. Everything else that clears a conservative score threshold is persisted
 *      as a `candidate` for human/automated review, never auto-linked.
 *   4. Below the candidate threshold, the pair is reported as `no_match` and is
 *      not persisted at all (callers should not write a decision row for it).
 *
 * This module is pure and side-effect free: it scores a pair and returns an
 * explainable result. Persisting the result via `upsertVehicleIdentityDecision`
 * (idempotent by listing pair) is the caller's job — see
 * `apps/scraper/src/jobs/match-vehicle-identity.ts`.
 */

/** The minimal listing shape the matcher needs. A subset of `@wivwav/db`'s `Listing`. */
export interface MatchableListing {
  id: string
  sourceId: string
  dealerProfileId: string | null
  dealerWebsite: string | null
  dealerName: string | null
  stockNumber: string | null
  sourceUrl: string
  make: string
  model: string
  year: number
  trim: string | null
  vin: string | null
  mileage: number | null
  priceCents: number | null
  zip: string | null
  city: string | null
  state: string | null
  /**
   * Trusted perceptual/content image hashes for this listing, as produced by
   * the image-integrity pipeline (#503). This matcher only *consumes* hashes —
   * it never computes them. Absent/empty means "no image evidence available",
   * not "no images."
   */
  trustedImageHashes?: readonly string[]
  /**
   * Set by the image-integrity pipeline when it has positively determined that
   * this listing's trusted imagery shows a *different* physical vehicle than
   * the listing it is being compared against (e.g. a hash match against a
   * known-distinct vehicle's canonical gallery). This is the ONLY image signal
   * treated as negative evidence — a plain lack of hash overlap is not, since
   * two genuine photos of the same vehicle from different angles/sources
   * legitimately produce different hashes, and shared hashes (reuse) are
   * positive evidence, never a conflict.
   */
  conflictingImageHash?: boolean
}

export type VehicleIdentityMatchDecision = 'auto_link' | 'candidate' | 'no_match'

export interface MatchSignal {
  /** Machine-readable signal id, stable across matcher versions for audit trails. */
  id: string
  /** Human-readable explanation of what was compared and why it matched/conflicted. */
  detail: string
  /** Points contributed to (positive) or against (negative) the match score. */
  weight: number
}

export interface VehicleIdentityMatchResult {
  decision: VehicleIdentityMatchDecision
  /** Total score across all contributing signals (negative-evidence signals short-circuit before scoring). */
  score: number
  /** Every signal considered, in evaluation order, for audit/explainability. */
  signals: MatchSignal[]
  /** Matcher rule-set version, persisted alongside the decision for audit. */
  ruleId: string
  /** True when a stable-identifier exact-match rule fired (see MATCHER_RULE_ID docs). */
  stableIdentifierMatch: boolean
}

/**
 * Matcher rule-set version. Bump this whenever the scoring weights, threshold,
 * or rule definitions below change, so historical decisions remain
 * attributable to the rule version that produced them.
 */
export const MATCHER_RULE_ID = 'non-vin-matcher-v1'

/** Score at/above which a non-stable-identifier pair is persisted as a `candidate`. */
export const CANDIDATE_THRESHOLD = 50

/** Mileage difference (miles) still considered "within tolerance" between two observations of the same vehicle. */
const MILEAGE_TOLERANCE_MILES = 1500

/** Price difference (as a fraction of the lower price) still considered "within tolerance." Dealers commonly adjust price by a few percent across postings/sources. */
const PRICE_TOLERANCE_FRACTION = 0.05

/** Maximum model-year delta still considered "compatible" (handles a calendar-year/model-year mislabel). */
const YEAR_COMPATIBLE_DELTA = 1

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/** A dealer "identity" for stable-identifier matching: prefer the normalized profile id, then website host, then name. */
function dealerIdentity(listing: MatchableListing): string | null {
  if (listing.dealerProfileId) return `profile:${listing.dealerProfileId}`
  if (listing.dealerWebsite) {
    try {
      return `host:${new URL(listing.dealerWebsite).host.toLowerCase()}`
    } catch {
      // fall through to name
    }
  }
  return normalizeText(listing.dealerName) ? `name:${normalizeText(listing.dealerName)!}` : null
}

function normalizedStockNumber(listing: MatchableListing): string | null {
  return normalizeText(listing.stockNumber)
}

/** True when both listings carry a structurally+check-digit valid VIN and the VINs differ. */
function hasConflictingValidVin(a: MatchableListing, b: MatchableListing): boolean {
  if (!a.vin || !b.vin) return false
  const vinA = normalizeVin(a.vin)
  const vinB = normalizeVin(b.vin)
  if (!isValidVin(vinA) || !checkDigitValid(vinA)) return false
  if (!isValidVin(vinB) || !checkDigitValid(vinB)) return false
  return vinA !== vinB
}

function isIncompatibleVehicle(a: MatchableListing, b: MatchableListing): { incompatible: boolean; reason: string | null } {
  const makeA = normalizeText(a.make)
  const makeB = normalizeText(b.make)
  const modelA = normalizeText(a.model)
  const modelB = normalizeText(b.model)

  if (makeA && makeB && makeA !== makeB) {
    return { incompatible: true, reason: `make mismatch (${a.make} vs ${b.make})` }
  }
  if (modelA && modelB && modelA !== modelB) {
    return { incompatible: true, reason: `model mismatch (${a.model} vs ${b.model})` }
  }
  if (Math.abs(a.year - b.year) > YEAR_COMPATIBLE_DELTA) {
    return { incompatible: true, reason: `year delta ${Math.abs(a.year - b.year)} exceeds tolerance (${a.year} vs ${b.year})` }
  }
  return { incompatible: false, reason: null }
}

/**
 * Score and classify a candidate listing pair.
 *
 * Negative evidence is evaluated first and is absolute: any hit forces
 * `no_match` regardless of how strong the positive signals are, and no
 * further positive signals are scored (the negative-evidence signal is
 * still returned for audit).
 */
export function matchListingPair(a: MatchableListing, b: MatchableListing): VehicleIdentityMatchResult {
  const signals: MatchSignal[] = []

  // ── Negative evidence (hard gate) ───────────────────────────────────────

  if (hasConflictingValidVin(a, b)) {
    signals.push({
      id: 'conflicting_vin',
      detail: `valid VINs differ (${normalizeVin(a.vin!)} vs ${normalizeVin(b.vin!)})`,
      weight: 0,
    })
    return { decision: 'no_match', score: 0, signals, ruleId: MATCHER_RULE_ID, stableIdentifierMatch: false }
  }

  const incompatibility = isIncompatibleVehicle(a, b)
  if (incompatibility.incompatible) {
    signals.push({ id: 'incompatible_vehicle', detail: incompatibility.reason!, weight: 0 })
    return { decision: 'no_match', score: 0, signals, ruleId: MATCHER_RULE_ID, stableIdentifierMatch: false }
  }

  if (a.conflictingImageHash || b.conflictingImageHash) {
    signals.push({
      id: 'conflicting_image_hash',
      detail: 'image-integrity pipeline flagged trusted imagery as showing a different vehicle',
      weight: 0,
    })
    return { decision: 'no_match', score: 0, signals, ruleId: MATCHER_RULE_ID, stableIdentifierMatch: false }
  }

  // ── Stable-identifier exact match (auto-link) ───────────────────────────
  // "Stable identifier" = a same-dealer + same-stock-number pair, or an
  // identical source URL (the same listing re-observed). Both are treated as
  // effectively certain matches because they require an operator-controlled,
  // low-cardinality identifier to coincide — not a fuzzy similarity score.

  const dealerA = dealerIdentity(a)
  const dealerB = dealerIdentity(b)
  const stockA = normalizedStockNumber(a)
  const stockB = normalizedStockNumber(b)

  let stableIdentifierMatch = false

  if (dealerA && dealerB && dealerA === dealerB && stockA && stockB && stockA === stockB) {
    signals.push({
      id: 'stable_dealer_stock_number',
      detail: `same dealer (${dealerA}) and stock number (${stockA})`,
      weight: 100,
    })
    stableIdentifierMatch = true
  }

  if (a.sourceUrl && b.sourceUrl && a.sourceUrl === b.sourceUrl) {
    signals.push({ id: 'identical_source_url', detail: `identical source URL (${a.sourceUrl})`, weight: 100 })
    stableIdentifierMatch = true
  }

  if (stableIdentifierMatch) {
    const score = signals.reduce((sum, s) => sum + s.weight, 0)
    return { decision: 'auto_link', score, signals, ruleId: MATCHER_RULE_ID, stableIdentifierMatch: true }
  }

  // ── Fuzzy signals (candidate only — never auto-link without a stable identifier) ──

  if (dealerA && dealerB && dealerA === dealerB) {
    signals.push({ id: 'same_dealer', detail: `same dealer (${dealerA})`, weight: 15 })
  }

  const trimA = normalizeText(a.trim)
  const trimB = normalizeText(b.trim)
  if (trimA && trimB) {
    if (trimA === trimB) {
      signals.push({ id: 'trim_match', detail: `matching trim (${a.trim})`, weight: 10 })
    } else {
      signals.push({ id: 'trim_mismatch', detail: `trim differs (${a.trim} vs ${b.trim})`, weight: -10 })
    }
  }

  // make/model/year already confirmed compatible by the negative-evidence gate;
  // award a baseline identity-compatibility signal so two fuzzy near-misses on
  // other fields still have a coherent vehicle-identity anchor.
  signals.push({
    id: 'compatible_make_model_year',
    detail: `compatible vehicle identity (${a.year}/${a.make}/${a.model} vs ${b.year}/${b.make}/${b.model})`,
    weight: 15,
  })

  if (a.mileage != null && b.mileage != null) {
    const delta = Math.abs(a.mileage - b.mileage)
    if (delta <= MILEAGE_TOLERANCE_MILES) {
      signals.push({ id: 'mileage_within_tolerance', detail: `mileage delta ${delta} mi within tolerance`, weight: 15 })
    } else {
      signals.push({ id: 'mileage_outside_tolerance', detail: `mileage delta ${delta} mi exceeds tolerance`, weight: -5 })
    }
  }

  if (a.priceCents != null && b.priceCents != null && a.priceCents > 0 && b.priceCents > 0) {
    const lower = Math.min(a.priceCents, b.priceCents)
    const delta = Math.abs(a.priceCents - b.priceCents)
    if (delta <= lower * PRICE_TOLERANCE_FRACTION) {
      signals.push({ id: 'price_within_tolerance', detail: `price delta ${delta} cents within tolerance`, weight: 10 })
    } else {
      signals.push({ id: 'price_outside_tolerance', detail: `price delta ${delta} cents exceeds tolerance`, weight: -5 })
    }
  }

  const zipA = normalizeText(a.zip)
  const zipB = normalizeText(b.zip)
  const cityA = normalizeText(a.city)
  const cityB = normalizeText(b.city)
  const stateA = normalizeText(a.state)
  const stateB = normalizeText(b.state)
  if (zipA && zipB && zipA === zipB) {
    signals.push({ id: 'same_zip', detail: `same zip (${a.zip})`, weight: 10 })
  } else if (cityA && cityB && stateA && stateB && cityA === cityB && stateA === stateB) {
    signals.push({ id: 'same_city_state', detail: `same city/state (${a.city}, ${a.state})`, weight: 7 })
  }

  if (stockA && stockB && stockA === stockB && (!dealerA || !dealerB || dealerA !== dealerB)) {
    // Same stock number without a confirmed-same dealer is supportive but not
    // a stable identifier on its own (stock numbers are dealer-scoped and can
    // coincide across unrelated dealers).
    signals.push({ id: 'matching_stock_number_unconfirmed_dealer', detail: `stock number matches (${stockA}) but dealer identity unconfirmed`, weight: 8 })
  }

  const hashesA = a.trustedImageHashes ?? []
  const hashesB = b.trustedImageHashes ?? []
  if (hashesA.length > 0 && hashesB.length > 0) {
    const setB = new Set(hashesB)
    const overlap = hashesA.filter((h) => setB.has(h)).length
    if (overlap > 0) {
      // Shared trusted images are positive evidence of the same physical vehicle.
      // This is legitimate even across sources/dealers (re-listing, syndication) —
      // it is never treated as a conflict signal.
      signals.push({ id: 'trusted_image_hash_overlap', detail: `${overlap} shared trusted image hash(es)`, weight: 20 })
    }
  }

  const score = signals.reduce((sum, s) => sum + s.weight, 0)

  // Fuzzy signals can only ever produce a `candidate`, never `auto_link` — per
  // the AC, only a stable-identifier exact match (handled above) is safe to
  // auto-link. No combination of fuzzy signals is treated as "certain enough."
  if (score >= CANDIDATE_THRESHOLD) {
    return { decision: 'candidate', score, signals, ruleId: MATCHER_RULE_ID, stableIdentifierMatch: false }
  }
  return { decision: 'no_match', score, signals, ruleId: MATCHER_RULE_ID, stableIdentifierMatch: false }
}
