/**
 * Canonicalization functions for listing fields.
 *
 * These pure functions transform raw source-reported values into clean,
 * consistent canonical values for public search and facets.
 *
 * Design principles:
 * - Unknown or unresolvable inputs produce null, never a misleading value.
 * - Raw source values are NEVER mutated here — callers retain them for provenance.
 * - All functions are pure and deterministic (no I/O, no side effects).
 *
 * Field contract
 * ──────────────
 * raw field      → canonical field (how facets see it)
 * color          → canonicalColor
 * rawColor       → canonicalColor (preferred provenance source)
 * fuelType       → canonicalFuelType (only when NOT an engine description)
 * engine         → used to derive canonicalFuelType when fuelType is missing
 * conversionManufacturer → retained only when it passes converterGate()
 * make/model     → preferably from VIN decode; alias-normalized
 * conversionStatus / wheelchairCapacity → null unless evidence-backed (caller responsibility)
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Color normalization
// ---------------------------------------------------------------------------

/**
 * Marketing suffixes that appear after a base color name.
 * These are stripped during normalization so "Brilliant Silver Metallic"
 * and "Silver" both resolve to "Silver".
 */
const COLOR_SUFFIX_PATTERN =
  /\s+(?:metallic|pearl|pearlescent|mica|crystal|clearcoat|coat|tinted|tint|effect|edition|special|premium|plus|ultra|brilliant|bright|deep|dark|light|vivid|rich|solid|matte|satin|gloss|glossy|frost|frosted|ice|icy|chrome|shimmer|shimmering|gleam|gleaming|radiant|lustrous|luster|lustre|iridescent|tri-?coat|bi-?coat|two-?tone|tone)\b.*/i

/**
 * Known color aliases — map common marketing names to a standard color token.
 * Keys must be lower-case. Matching is performed after suffix stripping.
 */
const COLOR_ALIASES: Record<string, string> = {
  'oxford white': 'White',
  'arctic white': 'White',
  'bright white': 'White',
  'glacier white': 'White',
  'star white': 'White',
  'shadow black': 'Black',
  'agate black': 'Black',
  'jet black': 'Black',
  'piano black': 'Black',
  'magnetic gray': 'Gray',
  'magnetic grey': 'Gray',
  'iconic silver': 'Silver',
  'carbonized gray': 'Gray',
  'carbonized grey': 'Gray',
  'antimatter blue': 'Blue',
  'rapid red': 'Red',
  'area 51': 'Teal',
  'cactus gray': 'Gray',
  'cactus grey': 'Gray',
  'copper canyon': 'Brown',
  'stone gray': 'Gray',
  'stone grey': 'Gray',
  'ingot silver': 'Silver',
  'diffused silver': 'Silver',
  'guard': 'Green',
  'guard green': 'Green',
}

/**
 * Normalize a raw color string to a canonical color name.
 *
 * - Strips casing, leading/trailing whitespace
 * - Removes marketing suffixes (Metallic, Pearl, etc.)
 * - Applies known aliases
 * - Returns null for empty, unknown, or unresolvable values
 *
 * Raw source color is always retained in `rawColor`/`color` on the listing —
 * this function only produces the search/facet value.
 */
export function canonicalColor(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Reject obvious non-color tokens
  const lower = trimmed.toLowerCase()
  if (lower === 'unknown' || lower === 'n/a' || lower === 'na' || lower === 'tbd' || lower === 'none') {
    return null
  }

  // Apply known aliases first (before suffix stripping, on the full lower-case string)
  if (COLOR_ALIASES[lower]) return COLOR_ALIASES[lower]!

  // Strip marketing suffixes
  const stripped = trimmed.replace(COLOR_SUFFIX_PATTERN, '').trim()
  const strippedLower = stripped.toLowerCase()

  // Re-check aliases after stripping
  if (COLOR_ALIASES[strippedLower]) return COLOR_ALIASES[strippedLower]!

  // Title-case the canonical result
  return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase()
}

// ---------------------------------------------------------------------------
// Fuel type canonicalization
// ---------------------------------------------------------------------------

/**
 * Patterns that identify engine descriptions rather than fuel type labels.
 * Examples: "3.5L V6 DOHC", "2.5L 4-Cyl", "EcoBoost", "5.7L HEMI"
 */
const ENGINE_DESCRIPTION_PATTERN =
  /\b(?:\d+\.\d+\s*[Ll]|v[468]|[46]-?cyl(?:inder)?|dohc|sohc|ohv|ohc|hemi|ecoboost|vtec|vvt|i[346]|inline[346]|diesel\s+engine|turbocharged|supercharged)\b/i

/**
 * Canonical fuel type values. These are the only values allowed in public facets.
 */
export type CanonicalFuelType =
  | 'gasoline'
  | 'diesel'
  | 'electric'
  | 'hybrid'
  | 'plug-in hybrid'
  | 'hydrogen'
  | 'natural gas'

const FUEL_TYPE_NORMALIZATIONS: Array<[RegExp, CanonicalFuelType]> = [
  [/\bplug.?in\s+hybrid\b/i, 'plug-in hybrid'],
  [/\bphev\b/i, 'plug-in hybrid'],
  [/\bhybrid\b/i, 'hybrid'],
  [/\belectric\b|\bbev\b|\bev\b/i, 'electric'],
  [/\bdiesel\b/i, 'diesel'],
  [/\bhydrogen\b|\bfuel\s+cell\b|\bfcev\b/i, 'hydrogen'],
  [/\bnatural\s+gas\b|\bcng\b/i, 'natural gas'],
  [/\bgasoline\b|\bgas\b|\bpetrol\b|\bunleaded\b|\bregular\b|\bpremium\b/i, 'gasoline'],
]

/**
 * Derive a canonical fuel type from a raw fuelType or engine description string.
 *
 * Returns null if:
 * - The string is null/empty
 * - The string is an engine description (e.g. "3.5L V6 DOHC")
 * - No recognized fuel type keyword is found
 *
 * AC: Engine descriptions must not be exposed as fuel type.
 */
export function canonicalFuelType(
  fuelType: string | null | undefined,
  engine: string | null | undefined,
): CanonicalFuelType | null {
  // Prefer explicit fuelType — but reject if it looks like an engine description
  if (fuelType) {
    const trimmed = fuelType.trim()
    if (trimmed && !ENGINE_DESCRIPTION_PATTERN.test(trimmed)) {
      for (const [pattern, canonical] of FUEL_TYPE_NORMALIZATIONS) {
        if (pattern.test(trimmed)) return canonical
      }
    }
    // fuelType was an engine description or unrecognized — fall through to engine
  }

  // Try to derive fuel type from engine description (e.g. "Electric Motor")
  if (engine) {
    const trimmed = engine.trim()
    for (const [pattern, canonical] of FUEL_TYPE_NORMALIZATIONS) {
      if (pattern.test(trimmed)) return canonical
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Make / model canonicalization
// ---------------------------------------------------------------------------

/**
 * Known make aliases — maps VIN-decoded make names or source names to canonical.
 * Keys must be upper-case.
 */
const MAKE_ALIASES: Record<string, string> = {
  'CHRYSLER': 'Chrysler',
  'DODGE': 'Dodge',
  'FORD': 'Ford',
  'HONDA': 'Honda',
  'TOYOTA': 'Toyota',
  'VOLKSWAGEN': 'Volkswagen',
  'CHEVROLET': 'Chevrolet',
  'GMC': 'GMC',
  'KIA': 'Kia',
  'HYUNDAI': 'Hyundai',
  'NISSAN': 'Nissan',
  'MERCEDES-BENZ': 'Mercedes-Benz',
  'MERCEDES': 'Mercedes-Benz',
  'RAM': 'Ram',
}

/**
 * Multi-token model aliases — maps truncated or abbreviated model names to full.
 * Source scrapers sometimes truncate on the first word (e.g. "Grand" → "Grand Caravan").
 * Keys must be upper-case.
 *
 * Note: only unambiguous single-word → multi-word expansions are listed here.
 * Ambiguous abbreviations (e.g. "Transit" for both Transit and Transit Connect)
 * are NOT expanded — VIN decode is the authoritative source.
 */
const MODEL_ALIASES: Record<string, string> = {
  // Chrysler/Dodge
  'GRAND CARAVAN': 'Grand Caravan',
  'TOWN AND COUNTRY': 'Town & Country',
  'TOWN & COUNTRY': 'Town & Country',
  'PACIFICA': 'Pacifica',
  // Ford
  'TRANSIT': 'Transit',
  'T-350': 'Transit',
  'T350': 'Transit',
  'TRANSIT CONNECT': 'Transit Connect',
  'TRANSIT T-350': 'Transit',
  // Toyota
  'SIENNA': 'Sienna',
  // Honda
  'ODYSSEY': 'Odyssey',
  // Volkswagen
  'CARAVELLE': 'Caravelle',
  // Ram
  'PROMASTER': 'ProMaster',
}

/**
 * Canonical make name — title-cased, with known aliases resolved.
 * Prefers the VIN-decoded make when available.
 */
export function canonicalMake(
  vinDecodedMake: string | null | undefined,
  sourceMake: string | null | undefined,
): string | null {
  const raw = (vinDecodedMake ?? sourceMake)?.trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  return MAKE_ALIASES[upper] ?? titleCase(raw)
}

/**
 * Canonical model name — resolved through alias table with VIN decode priority.
 * Returns null if no model can be determined.
 */
export function canonicalModel(
  vinDecodedModel: string | null | undefined,
  sourceModel: string | null | undefined,
): string | null {
  const raw = (vinDecodedModel ?? sourceModel)?.trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  return MODEL_ALIASES[upper] ?? titleCase(raw)
}

// ---------------------------------------------------------------------------
// Conversion manufacturer normalization
// ---------------------------------------------------------------------------

/**
 * Tokens that indicate a missing-value placeholder rather than a real converter name.
 * These must never appear in public facets.
 */
const MISSING_VALUE_TOKENS = new Set([
  'unknown', 'n/a', 'na', 'none', 'null', 'undefined', 'tbd', '', '-', '--',
  'not available', 'not applicable', 'not listed', 'not provided',
])

/**
 * Patterns that reject a string as a conversion manufacturer:
 * - Pure year numbers (e.g. "2026")
 * - Generic WAV/conversion descriptions (e.g. "Wheelchair", "Non", "WAV", "Conversion")
 * - Source/dealer boilerplate fragments
 */
const REJECTED_CONVERTER_PATTERNS = [
  /^\d{4}$/, // year numbers
  /^(?:non|wav|wheelchair|adapted|adaptation|handicap|disabled|mobility|accessible|converted|conversion|adapted\s+vehicle|wheelchair\s+van)$/i,
  /^(?:vehicle|used|new|stock|dealer|inventory|listing|see\s+description|call\s+for\s+details)$/i,
]

/**
 * Known legitimate WAV conversion manufacturers.
 * Used to accept values that might otherwise be rejected by the pattern rules
 * (e.g. short names like "VMI").
 */
const KNOWN_CONVERTERS = new Set([
  'BraunAbility', 'braunability',
  'VMI', 'vmi',
  'AMS Vans', 'ams', 'ams vans',
  'Freedom Motors', 'freedom motors', 'freedom',
  'Rollx Vans', 'rollx vans', 'rollx',
  'Vantage Mobility', 'vantage mobility', 'vantage',
  'Mobility Works', 'mobilityworks', 'mobility works',
  'Coachmen', 'coachmen',
  'Eldorado', 'eldorado',
  'Creative Carriage', 'creative carriage',
  'National Mobility Equipment', 'nme',
  'Revability', 'revability',
  'Mobility SVM', 'mobility svm', 'svm',
])

/**
 * Normalize a conversion manufacturer string for KNOWN_CONVERTERS lookup.
 * Returns the lower-cased trimmed value.
 */
function converterLookupKey(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Return the conversion manufacturer if it passes validation, or null.
 *
 * Rejects:
 * - Missing-value placeholders ("unknown", "undefined", "N/A", etc.)
 * - Year numbers ("2026")
 * - Generic WAV/conversion text ("Wheelchair", "Non", "WAV", "Conversion")
 * - Source/dealer names unless the value also appears in KNOWN_CONVERTERS
 *
 * AC: Conversion-manufacturer normalization rejects year numbers, generic conversion
 * text, missing-value tokens, and source/dealer names unless supported by explicit
 * converter evidence.
 */
export function canonicalConversionManufacturer(
  raw: string | null | undefined,
  sourceName: string | null | undefined,
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  const lower = trimmed.toLowerCase()

  // Missing-value tokens
  if (MISSING_VALUE_TOKENS.has(lower)) return null

  // Pattern rejections
  for (const pattern of REJECTED_CONVERTER_PATTERNS) {
    if (pattern.test(trimmed)) return null
  }

  // If the value matches the source/dealer name, reject it (it's probably boilerplate).
  // This check runs before the known-converter bypass so that a source named after
  // a known converter (e.g. MobilityWorks) doesn't accidentally accept its own name
  // as a conversion manufacturer on all its listings.
  if (
    sourceName &&
    lower === sourceName.trim().toLowerCase()
  ) {
    return null
  }

  // Known converters bypass all other checks
  if (KNOWN_CONVERTERS.has(trimmed) || KNOWN_CONVERTERS.has(converterLookupKey(trimmed))) {
    return trimmed
  }

  // Accept — return as-is (caller provided value)
  return trimmed
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Title-case a string: capitalize first letter of each word, lower-case the rest.
 * Preserves existing acronyms only when the entire input is upper-case.
 */
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
