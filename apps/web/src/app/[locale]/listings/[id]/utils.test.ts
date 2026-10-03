import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  abbreviate,
  conditionLabel,
  daysSince,
  estimateMonthly,
  formatDate,
  formatEnum,
  formatK,
  formatPrice,
  getExpectedLifespan,
  rampLabel,
} from './utils'
import { createTestTranslator } from '@/test-utils/intl'

const t = createTestTranslator('FiltersPage.listing', 'en')
const tEs = createTestTranslator('FiltersPage.listing', 'es')

describe('formatPrice', () => {
  it('formats cents as dollars and handles null', () => {
    expect(formatPrice(2_599_900, 'en', 'Call for price')).toBe('$25,999')
    expect(formatPrice(null, 'en', 'Call for price')).toBe('Call for price')
    expect(formatPrice(null, 'es', 'Llame para conocer el precio')).toBe('Llame para conocer el precio')
  })
})

describe('formatEnum / labels', () => {
  it('title-cases snake_case values', () => {
    expect(formatEnum('side_entry_van')).toBe('Side Entry Van')
  })

  it('maps known conditions and falls back to formatEnum', () => {
    expect(conditionLabel('certified_pre_owned', t)).toBe('CPO')
    expect(conditionLabel('used', t)).toBe('Used')
    expect(conditionLabel('new', t)).toBe('New')
    expect(conditionLabel('new', tEs)).toBe('Nuevo')
    expect(conditionLabel('salvage_title', t)).toBe('Salvage Title')
  })

  it('maps known ramp types and falls back to formatEnum', () => {
    expect(rampLabel('in_floor', t)).toBe('In-floor ramp')
    expect(rampLabel('fold_out', t)).toBe('Fold-out ramp')
    expect(rampLabel('fold_in', t)).toBe('Fold-in ramp')
    expect(rampLabel('power_lift', t)).toBe('Power Lift')
  })
})

describe('daysSince', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-11T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('counts whole days and never goes negative', () => {
    expect(daysSince('2026-01-01T12:00:00Z')).toBe(10)
    expect(daysSince('2026-01-10T13:00:00Z')).toBe(0)
    expect(daysSince('2027-01-01T00:00:00Z')).toBe(0)
  })
})

describe('estimateMonthly', () => {
  it('amortizes 80% of the price over 60 months at 6.5%', () => {
    expect(estimateMonthly(5_000_000)).toBe(783)
    expect(estimateMonthly(0)).toBe(0)
  })
})

describe('getExpectedLifespan', () => {
  it('is case-insensitive with a 200k default', () => {
    expect(getExpectedLifespan('Toyota')).toBe(250000)
    expect(getExpectedLifespan('HONDA')).toBe(230000)
    expect(getExpectedLifespan('Unknownmake')).toBe(200000)
  })
})

describe('abbreviate / formatK / formatDate', () => {
  it('abbreviates to at most two initials', () => {
    expect(abbreviate('Braun Ability Mobility')).toBe('BA')
    expect(abbreviate('vmi')).toBe('V')
    expect(abbreviate('')).toBe('')
  })

  it('rounds thousands to K', () => {
    expect(formatK(999)).toBe('999')
    expect(formatK(12_400)).toBe('12K')
    expect(formatK(12_600)).toBe('13K')
  })

  it('formats dates for the locale', () => {
    expect(formatDate('2026-03-14T12:00:00Z', 'en')).toBe('Mar 14, 2026')
    expect(formatDate('2026-03-14T12:00:00Z', 'es')).toBe('14 mar 2026')
  })
})
