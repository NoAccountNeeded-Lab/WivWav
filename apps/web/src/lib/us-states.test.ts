import { describe, expect, it } from 'vitest'
import { US_STATE_NAME_TO_ABBR, US_TERRITORY_ABBREVIATIONS } from './us-states'

describe('US_STATE_NAME_TO_ABBR', () => {
  it('maps all 50 states plus DC to a 2-letter USPS abbreviation', () => {
    const abbreviations = Object.values(US_STATE_NAME_TO_ABBR)
    const stateAbbreviations = abbreviations.filter((a) => !US_TERRITORY_ABBREVIATIONS.has(a))
    expect(stateAbbreviations).toHaveLength(51)
    for (const abbr of stateAbbreviations) {
      expect(abbr).toMatch(/^[A-Z]{2}$/)
    }
  })

  it('resolves known state names to their abbreviation', () => {
    expect(US_STATE_NAME_TO_ABBR['California']).toBe('CA')
    expect(US_STATE_NAME_TO_ABBR['Texas']).toBe('TX')
    expect(US_STATE_NAME_TO_ABBR['District of Columbia']).toBe('DC')
  })

  it('has no duplicate abbreviations', () => {
    const abbreviations = Object.values(US_STATE_NAME_TO_ABBR)
    expect(new Set(abbreviations).size).toBe(abbreviations.length)
  })
})

describe('US_TERRITORY_ABBREVIATIONS', () => {
  it('lists the 5 non-state territories present in the topojson feature set', () => {
    expect(US_TERRITORY_ABBREVIATIONS.size).toBe(5)
    for (const abbr of US_TERRITORY_ABBREVIATIONS) {
      expect(Object.values(US_STATE_NAME_TO_ABBR)).toContain(abbr)
    }
  })
})
