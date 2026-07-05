/**
 * Tests for canonicalize.ts — canonicalization functions for listing fields.
 *
 * Test cases are anchored to the observed audit data from 2026-06-29 (refs #515):
 * - 364 BLVD color strings
 * - 60 converter strings including "2026", "Non", "Wheelchair", "undefined"
 * - 340 fuelType values that were actually engine descriptions
 */
import { describe, it, expect } from 'vitest'
import {
  canonicalColor,
  canonicalFuelType,
  canonicalMake,
  canonicalModel,
  canonicalConversionManufacturer,
  conversionBrandSlug,
  matchMultiWordModelTokenCount,
  MULTI_WORD_MODEL_FIRST_TOKENS,
} from './canonicalize.js'

// ---------------------------------------------------------------------------
// canonicalColor
// ---------------------------------------------------------------------------

describe('canonicalColor', () => {
  it('returns null for null/empty inputs', () => {
    expect(canonicalColor(null)).toBeNull()
    expect(canonicalColor(undefined)).toBeNull()
    expect(canonicalColor('')).toBeNull()
    expect(canonicalColor('   ')).toBeNull()
  })

  it('returns null for missing-value tokens', () => {
    expect(canonicalColor('unknown')).toBeNull()
    expect(canonicalColor('Unknown')).toBeNull()
    expect(canonicalColor('N/A')).toBeNull()
    expect(canonicalColor('n/a')).toBeNull()
    expect(canonicalColor('TBD')).toBeNull()
    expect(canonicalColor('None')).toBeNull()
  })

  it('strips marketing suffixes (Metallic, Pearl, Clearcoat)', () => {
    expect(canonicalColor('Silver Metallic')).toBe('Silver')
    expect(canonicalColor('Brilliant Silver Metallic')).toBe('Brilliant silver')
    expect(canonicalColor('Oxford White Clearcoat')).toBe('White') // alias
    expect(canonicalColor('Blue Pearl')).toBe('Blue')
    expect(canonicalColor('Red Pearlescent')).toBe('Red')
    expect(canonicalColor('Green Mica')).toBe('Green')
    expect(canonicalColor('Black Tinted')).toBe('Black')
  })

  it('applies known color aliases (title-cased canonical values)', () => {
    expect(canonicalColor('Oxford White')).toBe('White')
    expect(canonicalColor('Agate Black')).toBe('Black')
    expect(canonicalColor('Shadow Black')).toBe('Black')
    expect(canonicalColor('Magnetic Gray')).toBe('Gray')
    expect(canonicalColor('Magnetic Grey')).toBe('Gray')
    expect(canonicalColor('Iconic Silver')).toBe('Silver')
    expect(canonicalColor('Ingot Silver')).toBe('Silver')
    expect(canonicalColor('Rapid Red')).toBe('Red')
    expect(canonicalColor('Carbonized Gray')).toBe('Gray')
    expect(canonicalColor('Antimatter Blue')).toBe('Blue')
    expect(canonicalColor('Cactus Gray')).toBe('Gray')
  })

  it('collapses casing', () => {
    expect(canonicalColor('SILVER')).toBe('Silver')
    expect(canonicalColor('silver')).toBe('Silver')
    expect(canonicalColor('BLUE METALLIC')).toBe('Blue')
  })

  it('retains multi-word colors without aliases', () => {
    expect(canonicalColor('Deep Cherry Red')).toBe('Deep cherry red')
  })

  it('is idempotent on already-canonical values', () => {
    expect(canonicalColor('Silver')).toBe('Silver')
    expect(canonicalColor('Blue')).toBe('Blue')
    expect(canonicalColor('White')).toBe('White')
  })
})

// ---------------------------------------------------------------------------
// canonicalFuelType
// ---------------------------------------------------------------------------

describe('canonicalFuelType', () => {
  it('returns null when both inputs are null', () => {
    expect(canonicalFuelType(null, null)).toBeNull()
    expect(canonicalFuelType(undefined, undefined)).toBeNull()
  })

  it('rejects engine descriptions stored as fuelType (audit: 340 rows)', () => {
    // Audit examples from BLVD — engine descriptions that were stored as fuelType
    expect(canonicalFuelType('3.5L V6 24V PDI DOHC', null)).toBeNull()
    expect(canonicalFuelType('2.5L 4-Cyl DOHC 16V', null)).toBeNull()
    expect(canonicalFuelType('3.6L V6 DOHC 24V', null)).toBeNull()
    expect(canonicalFuelType('EcoBoost', null)).toBeNull()
    expect(canonicalFuelType('3.5L V6 EcoBoost', null)).toBeNull()
    expect(canonicalFuelType('5.7L HEMI', null)).toBeNull()
    expect(canonicalFuelType('3.0L Turbocharged Diesel', null)).toBeNull()
    expect(canonicalFuelType('2.0L I4 DOHC', null)).toBeNull()
    expect(canonicalFuelType('V6', null)).toBeNull()
    expect(canonicalFuelType('V8', null)).toBeNull()
    expect(canonicalFuelType('4-Cylinder', null)).toBeNull()
    expect(canonicalFuelType('6-Cylinder SOHC', null)).toBeNull()
  })

  it('accepts explicit fuel type labels from MobilityWorks', () => {
    expect(canonicalFuelType('Gasoline', null)).toBe('gasoline')
    expect(canonicalFuelType('Gas', null)).toBe('gasoline')
    expect(canonicalFuelType('Diesel', null)).toBe('diesel')
    expect(canonicalFuelType('Hybrid', null)).toBe('hybrid')
    expect(canonicalFuelType('Electric', null)).toBe('electric')
    expect(canonicalFuelType('Plug-In Hybrid', null)).toBe('plug-in hybrid')
    expect(canonicalFuelType('PHEV', null)).toBe('plug-in hybrid')
    expect(canonicalFuelType('Plug In Hybrid', null)).toBe('plug-in hybrid')
    expect(canonicalFuelType('BEV', null)).toBe('electric')
    expect(canonicalFuelType('EV', null)).toBe('electric')
    expect(canonicalFuelType('Natural Gas', null)).toBe('natural gas')
    expect(canonicalFuelType('CNG', null)).toBe('natural gas')
    expect(canonicalFuelType('Hydrogen', null)).toBe('hydrogen')
    expect(canonicalFuelType('Fuel Cell', null)).toBe('hydrogen')
  })

  it('derives fuel type from engine description when fuelType is null/engine', () => {
    // When fuelType is absent (BLVD pattern), engine can hint at fuel type
    expect(canonicalFuelType(null, 'Electric Motor 150kW')).toBe('electric')
    expect(canonicalFuelType(null, 'Hybrid Drive System')).toBe('hybrid')
    expect(canonicalFuelType(null, '3.0L Turbocharged Diesel Engine')).toBe('diesel')
    // Pure gasoline engine descriptions should NOT produce 'gasoline' via engine hint
    // because engine descriptions don't use gasoline keywords
    expect(canonicalFuelType(null, '3.5L V6 DOHC')).toBeNull()
  })

  it('prefers fuelType over engine when fuelType is valid', () => {
    expect(canonicalFuelType('Gasoline', '3.5L V6 DOHC')).toBe('gasoline')
    expect(canonicalFuelType('Hybrid', 'V6 Hybrid')).toBe('hybrid')
  })

  it('falls through to engine when fuelType is an engine description', () => {
    // fuelType looks like an engine description → use engine field instead
    expect(canonicalFuelType('3.5L V6 DOHC', 'Electric Motor')).toBe('electric')
  })
})

// ---------------------------------------------------------------------------
// canonicalMake
// ---------------------------------------------------------------------------

describe('canonicalMake', () => {
  it('returns null for null/empty inputs', () => {
    expect(canonicalMake(null, null)).toBeNull()
    expect(canonicalMake(undefined, undefined)).toBeNull()
  })

  it('prefers VIN-decoded make over source make', () => {
    expect(canonicalMake('FORD', 'Ford Motor')).toBe('Ford')
  })

  it('normalizes known makes', () => {
    expect(canonicalMake(null, 'FORD')).toBe('Ford')
    expect(canonicalMake(null, 'ford')).toBe('Ford')
    expect(canonicalMake(null, 'DODGE')).toBe('Dodge')
    expect(canonicalMake(null, 'CHRYSLER')).toBe('Chrysler')
    expect(canonicalMake(null, 'TOYOTA')).toBe('Toyota')
    expect(canonicalMake(null, 'HONDA')).toBe('Honda')
    expect(canonicalMake(null, 'GMC')).toBe('GMC')
    expect(canonicalMake(null, 'KIA')).toBe('Kia')
  })

  it('normalizes Mercedes-Benz alias', () => {
    expect(canonicalMake(null, 'MERCEDES')).toBe('Mercedes-Benz')
    expect(canonicalMake(null, 'Mercedes')).toBe('Mercedes-Benz')
    expect(canonicalMake(null, 'Mercedes-Benz')).toBe('Mercedes-Benz')
    expect(canonicalMake('MERCEDES-BENZ', null)).toBe('Mercedes-Benz')
  })

  it('title-cases unknown makes', () => {
    expect(canonicalMake(null, 'UNKNOWN MAKE')).toBe('Unknown Make')
  })
})

// ---------------------------------------------------------------------------
// canonicalModel
// ---------------------------------------------------------------------------

describe('canonicalModel', () => {
  it('returns null for null/empty inputs', () => {
    expect(canonicalModel(null, null)).toBeNull()
    expect(canonicalModel(undefined, undefined)).toBeNull()
  })

  it('resolves Grand Caravan alias (audit: truncated model)', () => {
    expect(canonicalModel(null, 'Grand Caravan')).toBe('Grand Caravan')
    expect(canonicalModel(null, 'GRAND CARAVAN')).toBe('Grand Caravan')
  })

  it('resolves Town and Country / Town & Country aliases', () => {
    expect(canonicalModel(null, 'Town and Country')).toBe('Town & Country')
    expect(canonicalModel(null, 'TOWN AND COUNTRY')).toBe('Town & Country')
    expect(canonicalModel(null, 'Town & Country')).toBe('Town & Country')
  })

  it('resolves Transit/T-350 aliases to Transit', () => {
    expect(canonicalModel(null, 'Transit')).toBe('Transit')
    expect(canonicalModel(null, 'T-350')).toBe('Transit')
    expect(canonicalModel(null, 'T350')).toBe('Transit')
  })

  it('resolves ProMaster alias (case)', () => {
    expect(canonicalModel(null, 'PROMASTER')).toBe('ProMaster')
  })

  it('prefers VIN-decoded model over source model', () => {
    // VIN decode returns full model name; source may have truncated it
    expect(canonicalModel('Grand Caravan', 'Grand')).toBe('Grand Caravan')
  })

  it('title-cases unknown models', () => {
    expect(canonicalModel(null, 'some unknown model')).toBe('Some Unknown Model')
  })
})

// ---------------------------------------------------------------------------
// matchMultiWordModelTokenCount (refs #618)
// ---------------------------------------------------------------------------

describe('matchMultiWordModelTokenCount', () => {
  it('matches "GRAND CARAVAN" as 2 tokens', () => {
    expect(matchMultiWordModelTokenCount(['GRAND', 'CARAVAN', 'SXT'])).toBe(2)
  })

  it('matches "TOWN & COUNTRY" as 3 tokens', () => {
    expect(matchMultiWordModelTokenCount(['TOWN', '&', 'COUNTRY', 'TOURING'])).toBe(3)
  })

  it('matches "TOWN AND COUNTRY" as 3 tokens', () => {
    expect(matchMultiWordModelTokenCount(['TOWN', 'AND', 'COUNTRY', 'LX'])).toBe(3)
  })

  it('matches "TRANSIT CONNECT" as 2 tokens', () => {
    expect(matchMultiWordModelTokenCount(['TRANSIT', 'CONNECT', 'XLT'])).toBe(2)
  })

  it('returns 0 for a single-word model with no multi-word candidate', () => {
    expect(matchMultiWordModelTokenCount(['SIENNA', 'FWD', 'XLE'])).toBe(0)
  })

  it('returns 0 for an empty token list', () => {
    expect(matchMultiWordModelTokenCount([])).toBe(0)
  })

  it('does not match a partial/truncated sequence', () => {
    // "Town & C" is missing the rest of "Country" — a different (unrelated) data
    // quality issue, not something this matcher should paper over.
    expect(matchMultiWordModelTokenCount(['TOWN', '&', 'C', 'TOURING'])).toBe(0)
  })

  it('prefers the longest match when multiple candidates could apply', () => {
    // "TRANSIT" alone is a single-word alias, but "TRANSIT CONNECT" must win
    // when both tokens are present.
    expect(matchMultiWordModelTokenCount(['TRANSIT', 'CONNECT'])).toBe(2)
  })
})

describe('MULTI_WORD_MODEL_FIRST_TOKENS', () => {
  it('includes the truncated first token of each known multi-word model', () => {
    expect(MULTI_WORD_MODEL_FIRST_TOKENS).toContain('TOWN')
    expect(MULTI_WORD_MODEL_FIRST_TOKENS).toContain('GRAND')
    expect(MULTI_WORD_MODEL_FIRST_TOKENS).toContain('TRANSIT')
  })

  it('has no duplicates', () => {
    expect(new Set(MULTI_WORD_MODEL_FIRST_TOKENS).size).toBe(MULTI_WORD_MODEL_FIRST_TOKENS.length)
  })
})

// ---------------------------------------------------------------------------
// canonicalConversionManufacturer
// ---------------------------------------------------------------------------

describe('canonicalConversionManufacturer', () => {
  it('returns null for null/empty inputs', () => {
    expect(canonicalConversionManufacturer(null, null)).toBeNull()
    expect(canonicalConversionManufacturer(undefined, null)).toBeNull()
    expect(canonicalConversionManufacturer('', null)).toBeNull()
    expect(canonicalConversionManufacturer('   ', null)).toBeNull()
  })

  it('rejects missing-value tokens (audit: "undefined" in 60 rows)', () => {
    expect(canonicalConversionManufacturer('unknown', null)).toBeNull()
    expect(canonicalConversionManufacturer('Unknown', null)).toBeNull()
    expect(canonicalConversionManufacturer('undefined', null)).toBeNull()
    expect(canonicalConversionManufacturer('N/A', null)).toBeNull()
    expect(canonicalConversionManufacturer('n/a', null)).toBeNull()
    expect(canonicalConversionManufacturer('None', null)).toBeNull()
    expect(canonicalConversionManufacturer('null', null)).toBeNull()
    expect(canonicalConversionManufacturer('TBD', null)).toBeNull()
    expect(canonicalConversionManufacturer('--', null)).toBeNull()
    expect(canonicalConversionManufacturer('not available', null)).toBeNull()
    expect(canonicalConversionManufacturer('Not Applicable', null)).toBeNull()
  })

  it('rejects year numbers (audit: "2026" in converter field)', () => {
    expect(canonicalConversionManufacturer('2026', null)).toBeNull()
    expect(canonicalConversionManufacturer('2025', null)).toBeNull()
    expect(canonicalConversionManufacturer('2010', null)).toBeNull()
    expect(canonicalConversionManufacturer('1999', null)).toBeNull()
  })

  it('rejects generic WAV/conversion text (audit: "Non", "Wheelchair")', () => {
    expect(canonicalConversionManufacturer('Non', null)).toBeNull()
    expect(canonicalConversionManufacturer('non', null)).toBeNull()
    expect(canonicalConversionManufacturer('Wheelchair', null)).toBeNull()
    expect(canonicalConversionManufacturer('wheelchair', null)).toBeNull()
    expect(canonicalConversionManufacturer('WAV', null)).toBeNull()
    expect(canonicalConversionManufacturer('Conversion', null)).toBeNull()
    expect(canonicalConversionManufacturer('Accessible', null)).toBeNull()
    expect(canonicalConversionManufacturer('Adapted', null)).toBeNull()
    expect(canonicalConversionManufacturer('Mobility', null)).toBeNull()
  })

  it('rejects values that match the source/dealer name', () => {
    expect(canonicalConversionManufacturer('MobilityWorks', 'MobilityWorks')).toBeNull()
    expect(canonicalConversionManufacturer('BLVD', 'BLVD')).toBeNull()
  })

  it('accepts known conversion manufacturers', () => {
    expect(canonicalConversionManufacturer('BraunAbility', null)).toBe('BraunAbility')
    expect(canonicalConversionManufacturer('VMI', null)).toBe('VMI')
    expect(canonicalConversionManufacturer('AMS Vans', null)).toBe('AMS Vans')
    expect(canonicalConversionManufacturer('Freedom Motors', null)).toBe('Freedom Motors')
    expect(canonicalConversionManufacturer('Rollx Vans', null)).toBe('Rollx Vans')
    expect(canonicalConversionManufacturer('Vantage Mobility', null)).toBe('Vantage Mobility')
  })

  it('accepts known converter case variants', () => {
    expect(canonicalConversionManufacturer('braunability', null)).toBe('braunability')
    expect(canonicalConversionManufacturer('vmi', null)).toBe('vmi')
    expect(canonicalConversionManufacturer('ams', null)).toBe('ams')
    expect(canonicalConversionManufacturer('freedom', null)).toBe('freedom')
    expect(canonicalConversionManufacturer('rollx', null)).toBe('rollx')
  })

  it('rejects dealer/source names that are not known converters', () => {
    // If the converter value exactly matches the source name, reject it
    expect(canonicalConversionManufacturer('Some Dealer Name', 'Some Dealer Name')).toBeNull()
  })

  it('is case-insensitive for source name rejection', () => {
    expect(canonicalConversionManufacturer('mobilityworks', 'MobilityWorks')).toBeNull()
  })

  // refs #603 — tightened from an earlier "reject known-bad patterns, accept
  // everything else" design (see git history) to a true allowlist. The old
  // fallback accepted any leftover string verbatim, including unrelated
  // company names *and* scraper extraction noise ("Yes", "FR", "Side", …)
  // that isn't a company name at all — there's no pattern that reliably
  // distinguishes the two, so unrecognized values must now produce null.
  it('rejects values not found in KNOWN_CONVERTERS, even plausible-looking company names', () => {
    expect(canonicalConversionManufacturer('Apex Mobility', null)).toBeNull()
    expect(canonicalConversionManufacturer('Northstar Conversions', null)).toBeNull()
  })

  it('rejects scraper extraction noise observed in the live conversionBrand facet (refs #603)', () => {
    expect(canonicalConversionManufacturer('Yes', null)).toBeNull()
    expect(canonicalConversionManufacturer('Commercial', null)).toBeNull()
    expect(canonicalConversionManufacturer('FR', null)).toBeNull()
    expect(canonicalConversionManufacturer('AT', null)).toBeNull()
    expect(canonicalConversionManufacturer('Side', null)).toBeNull()
    expect(canonicalConversionManufacturer('Passenger', null)).toBeNull()
    expect(canonicalConversionManufacturer('See', null)).toBeNull()
    expect(canonicalConversionManufacturer('Rear', null)).toBeNull()
    expect(canonicalConversionManufacturer('Regular', null)).toBeNull()
    expect(canonicalConversionManufacturer('Triple', null)).toBeNull()
    expect(canonicalConversionManufacturer('Adaptive', null)).toBeNull()
    expect(canonicalConversionManufacturer('Other', null)).toBeNull()
    // Low-confidence tail values with no verifiable brand evidence — nulled
    // rather than guessed at; candidates for a follow-up research pass.
    expect(canonicalConversionManufacturer('Americas', null)).toBeNull()
    expect(canonicalConversionManufacturer('Vanability', null)).toBeNull()
    expect(canonicalConversionManufacturer('Promaster', null)).toBeNull()
  })

  it('accepts newly curated converters (refs #603)', () => {
    expect(canonicalConversionManufacturer('Driverge', null)).toBe('Driverge')
    expect(canonicalConversionManufacturer('ATC', null)).toBe('ATC')
    expect(canonicalConversionManufacturer('ATS', null)).toBe('ATS')
    expect(canonicalConversionManufacturer('Tempest', null)).toBe('Tempest')
    expect(canonicalConversionManufacturer('Ryno', null)).toBe('Ryno')
    expect(canonicalConversionManufacturer('MV-1', null)).toBe('MV-1')
  })

  it('accepts variant spellings, typos, and product-line names pending slug aliasing (refs #603)', () => {
    expect(canonicalConversionManufacturer('Braun', null)).toBe('Braun')
    expect(canonicalConversionManufacturer('braun', null)).toBe('braun')
    expect(canonicalConversionManufacturer('MV1', null)).toBe('MV1')
    expect(canonicalConversionManufacturer('Revabilty', null)).toBe('Revabilty')
    expect(canonicalConversionManufacturer('Northstar', null)).toBe('Northstar')
    expect(canonicalConversionManufacturer('Entervan', null)).toBe('Entervan')
  })
})

// ---------------------------------------------------------------------------
// conversionBrandSlug
// ---------------------------------------------------------------------------

describe('conversionBrandSlug', () => {
  it('normalizes a conversion manufacturer string to the API slug format', () => {
    expect(conversionBrandSlug(' BraunAbility ')).toBe('braunability')
    expect(conversionBrandSlug('Freedom Motors')).toBe('freedom-motors')
    expect(conversionBrandSlug('AMS Vans')).toBe('ams-vans')
  })

  it('returns null for empty or missing values', () => {
    expect(conversionBrandSlug(null)).toBeNull()
    expect(conversionBrandSlug(undefined)).toBeNull()
    expect(conversionBrandSlug('   ')).toBeNull()
  })

  // refs #603 — newly mapped variants, abbreviations, typos, and product-line
  // names, folded onto the canonical curated-brand slug.
  it('folds newly mapped variants onto their canonical curated-brand slug', () => {
    expect(conversionBrandSlug('Braun')).toBe('braunability')
    expect(conversionBrandSlug('braun')).toBe('braunability')
    expect(conversionBrandSlug('MV1')).toBe('mv-1')
    expect(conversionBrandSlug('Revabilty')).toBe('revability')
    expect(conversionBrandSlug('Northstar')).toBe('vmi')
    expect(conversionBrandSlug('Entervan')).toBe('braunability')
    expect(conversionBrandSlug('ATS')).toBe('atc')
    expect(conversionBrandSlug('All Terrain Conversions')).toBe('atc')
  })

  it('leaves newly curated brand names as their own slug', () => {
    expect(conversionBrandSlug('Driverge')).toBe('driverge')
    expect(conversionBrandSlug('ATC')).toBe('atc')
    expect(conversionBrandSlug('Tempest')).toBe('tempest')
    expect(conversionBrandSlug('Ryno')).toBe('ryno')
    expect(conversionBrandSlug('MV-1')).toBe('mv-1')
    expect(conversionBrandSlug('MobilityWorks')).toBe('mobilityworks')
    expect(conversionBrandSlug('Eldorado')).toBe('eldorado')
    expect(conversionBrandSlug('Revability')).toBe('revability')
  })
})
