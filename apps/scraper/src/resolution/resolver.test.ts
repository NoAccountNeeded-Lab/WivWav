import { describe, expect, it } from 'vitest'
import { resolveField, resolveFields } from './resolver.js'
import type { FieldClaim } from './types.js'

const T0 = new Date('2026-01-01T00:00:00Z')
const T1 = new Date('2026-01-02T00:00:00Z')

function claim(overrides: Partial<FieldClaim> = {}): FieldClaim {
  return {
    listingId: 'listing-1',
    field: 'conversionType',
    claimedValue: 'rear_entry',
    evidenceKind: 'structured_source',
    sourceRef: 'https://source.example/card',
    observedAt: T0,
    extractorVersion: 'v1',
    confidence: null,
    eligible: true,
    ineligibleReason: null,
    ...overrides,
  }
}

describe('resolveField', () => {
  it('returns unknown with no claims', () => {
    expect(resolveField([])).toEqual({ value: 'unknown', state: 'unknown', conflictingClaims: [] })
  })

  it('marks a single credible signal as source_reported, not verified', () => {
    const result = resolveField([claim()])
    expect(result).toEqual({ value: 'rear_entry', state: 'source_reported', conflictingClaims: [] })
  })

  it('upgrades to verified when two independent credible signals agree (card + detail)', () => {
    const cardClaim = claim({ evidenceKind: 'structured_source', sourceRef: 'card-url' })
    const detailClaim = claim({
      evidenceKind: 'vehicle_text',
      sourceRef: 'detail-url',
      observedAt: T1,
    })
    const result = resolveField([cardClaim, detailClaim])
    expect(result.state).toBe('verified')
    expect(result.value).toBe('rear_entry')
  })

  it('resolves a credible card/category vs. detail-text contradiction to conflicting', () => {
    const cardClaim = claim({ evidenceKind: 'structured_source', claimedValue: 'side_entry', sourceRef: 'card-url' })
    const detailClaim = claim({
      evidenceKind: 'vehicle_text',
      claimedValue: 'rear_entry',
      sourceRef: 'detail-url',
      observedAt: T1,
    })
    const result = resolveField([cardClaim, detailClaim])
    expect(result.state).toBe('conflicting')
    expect(result.value).toBe('unknown')
    expect(result.conflictingClaims).toHaveLength(2)
  })

  it('a credible photo claim can conflict with a side-entry text claim', () => {
    const textClaim = claim({ evidenceKind: 'vehicle_text', claimedValue: 'side_entry', sourceRef: 'detail-url' })
    const photoClaim = claim({
      evidenceKind: 'photo',
      claimedValue: 'rear_entry',
      sourceRef: 'https://cdn.example/photo-1.jpg',
      confidence: 0.9,
      observedAt: T1,
    })
    const result = resolveField([textClaim, photoClaim])
    expect(result.state).toBe('conflicting')
  })

  it('ignores a low-confidence photo claim entirely — cannot establish or override', () => {
    const textClaim = claim({ evidenceKind: 'vehicle_text', claimedValue: 'side_entry', sourceRef: 'detail-url' })
    const lowConfidencePhoto = claim({
      evidenceKind: 'photo',
      claimedValue: 'rear_entry',
      sourceRef: 'https://cdn.example/photo-1.jpg',
      confidence: 0.4,
      observedAt: T1,
    })
    const result = resolveField([textClaim, lowConfidencePhoto])
    expect(result).toEqual({ value: 'side_entry', state: 'source_reported', conflictingClaims: [] })
  })

  it('ignores a reused/stock photo claim marked ineligible', () => {
    const textClaim = claim({ evidenceKind: 'vehicle_text', claimedValue: 'side_entry', sourceRef: 'detail-url' })
    const reusedPhoto = claim({
      evidenceKind: 'photo',
      claimedValue: 'rear_entry',
      sourceRef: 'https://cdn.example/stock.jpg',
      confidence: 0.95,
      observedAt: T1,
      eligible: false,
      ineligibleReason: 'reused across 12 vehicles',
    })
    const result = resolveField([textClaim, reusedPhoto])
    expect(result).toEqual({ value: 'side_entry', state: 'source_reported', conflictingClaims: [] })
  })

  it('ignores generic/boilerplate text claims', () => {
    const generic = claim({ evidenceKind: 'generic_text', claimedValue: 'rear_entry' })
    expect(resolveField([generic])).toEqual({ value: 'unknown', state: 'unknown', conflictingClaims: [] })
  })

  it('an authoritative source establishes verified alone, overriding weaker agreement elsewhere', () => {
    const cardClaim = claim({ evidenceKind: 'structured_source', claimedValue: 'side_entry', sourceRef: 'card-url' })
    const detailClaim = claim({
      evidenceKind: 'vehicle_text',
      claimedValue: 'side_entry',
      sourceRef: 'detail-url',
      observedAt: T1,
    })
    const buildSheet = claim({
      evidenceKind: 'authoritative_source',
      claimedValue: 'rear_entry',
      sourceRef: 'dealer-build-sheet',
      observedAt: T1,
    })
    const result = resolveField([cardClaim, detailClaim, buildSheet])
    expect(result).toEqual({ value: 'rear_entry', state: 'verified', conflictingClaims: [] })
  })

  it('two disagreeing authoritative sources are conflicting, not a coin flip', () => {
    const a = claim({ evidenceKind: 'authoritative_source', claimedValue: 'side_entry', sourceRef: 'sheet-a' })
    const b = claim({
      evidenceKind: 'authoritative_source',
      claimedValue: 'rear_entry',
      sourceRef: 'sheet-b',
      observedAt: T1,
    })
    const result = resolveField([a, b])
    expect(result.state).toBe('conflicting')
  })

  it('a later observation superseding an old conflicting claim resolves it (card corrects itself)', () => {
    const staleCard = claim({ evidenceKind: 'structured_source', claimedValue: 'side_entry', sourceRef: 'card-url', observedAt: T0 })
    const correctedCard = claim({ evidenceKind: 'structured_source', claimedValue: 'rear_entry', sourceRef: 'card-url', observedAt: T1 })
    const detailClaim = claim({ evidenceKind: 'vehicle_text', claimedValue: 'rear_entry', sourceRef: 'detail-url', observedAt: T1 })
    // All three rows may still be stored (append-only claim history), but the
    // resolver only considers the latest claim per (evidenceKind, sourceRef) slot.
    const result = resolveField([staleCard, correctedCard, detailClaim])
    expect(result).toEqual({ value: 'rear_entry', state: 'verified', conflictingClaims: [] })
  })

  it('a claim asserting "unknown" carries no information and does not create false agreement', () => {
    const unknownClaim = claim({ claimedValue: 'unknown', sourceRef: 'card-url' })
    const result = resolveField([unknownClaim])
    expect(result).toEqual({ value: 'unknown', state: 'unknown', conflictingClaims: [] })
  })

  it('an ineligible non-photo claim (explicitly marked) is excluded from resolution', () => {
    const ineligible = claim({ eligible: false, ineligibleReason: 'manual override' })
    expect(resolveField([ineligible])).toEqual({ value: 'unknown', state: 'unknown', conflictingClaims: [] })
  })

  it('rampType conflicts resolve the same way as conversionType', () => {
    const inFloor = claim({ field: 'rampType', evidenceKind: 'structured_source', claimedValue: 'in_floor', sourceRef: 'card-url' })
    const foldOut = claim({
      field: 'rampType',
      evidenceKind: 'vehicle_text',
      claimedValue: 'fold_out',
      sourceRef: 'detail-url',
      observedAt: T1,
    })
    const result = resolveField([inFloor, foldOut])
    expect(result.state).toBe('conflicting')
  })
})

describe('resolveFields', () => {
  it('resolves multiple fields independently', () => {
    const conversionClaim = claim()
    const rampClaim = claim({ field: 'rampType', claimedValue: 'in_floor' })
    const result = resolveFields({ conversionType: [conversionClaim], rampType: [rampClaim] })
    expect(result['conversionType']?.value).toBe('rear_entry')
    expect(result['rampType']?.value).toBe('in_floor')
  })
})
