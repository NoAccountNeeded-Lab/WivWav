import { describe, it, expect } from 'vitest'
import { parseVehicleTitle } from './parse-vehicle-title.js'

describe('parseVehicleTitle', () => {
  it('parses a single-word model with a multi-word trim', () => {
    const result = parseVehicleTitle('2024 Toyota Sienna FWD XLE')
    expect(result).toEqual({ year: 2024, make: 'Toyota', model: 'Sienna', trim: 'FWD XLE' })
  })

  it('parses a single-word model with no trim', () => {
    const result = parseVehicleTitle('2024 Toyota Sienna')
    expect(result).toEqual({ year: 2024, make: 'Toyota', model: 'Sienna', trim: null })
  })

  // refs #618 — "Town & Country" used to tokenize to model: "Town",
  // trim: "& Country Touring" because the naive parser assumed model was
  // always exactly one token.
  it('keeps "Town & Country" together as the model (refs #618)', () => {
    const result = parseVehicleTitle('2024 Chrysler Town & Country Touring')
    expect(result).toEqual({
      year: 2024,
      make: 'Chrysler',
      model: 'Town & Country',
      trim: 'Touring',
    })
  })

  it('keeps "Town and Country" together as the model', () => {
    const result = parseVehicleTitle('2019 Chrysler Town and Country LX')
    expect(result).toEqual({
      year: 2019,
      make: 'Chrysler',
      model: 'Town and Country',
      trim: 'LX',
    })
  })

  it('keeps "Town & Country" together with no trim', () => {
    const result = parseVehicleTitle('2019 Chrysler Town & Country')
    expect(result).toEqual({
      year: 2019,
      make: 'Chrysler',
      model: 'Town & Country',
      trim: null,
    })
  })

  // refs #618 — "Grand Caravan" used to tokenize to model: "Grand",
  // trim: "Caravan SXT".
  it('keeps "Grand Caravan" together as the model (refs #618)', () => {
    const result = parseVehicleTitle('2019 Dodge Grand Caravan SXT')
    expect(result).toEqual({
      year: 2019,
      make: 'Dodge',
      model: 'Grand Caravan',
      trim: 'SXT',
    })
  })

  it('keeps "Transit Connect" together as the model', () => {
    const result = parseVehicleTitle('2021 Ford Transit Connect XLT')
    expect(result).toEqual({
      year: 2021,
      make: 'Ford',
      model: 'Transit Connect',
      trim: 'XLT',
    })
  })

  it('handles a title with only year and make (no model)', () => {
    const result = parseVehicleTitle('2024 Toyota')
    expect(result).toEqual({ year: 2024, make: 'Toyota', model: '', trim: null })
  })

  it('handles an empty title body', () => {
    const result = parseVehicleTitle('')
    expect(result.make).toBe('')
    expect(result.model).toBe('')
    expect(result.trim).toBeNull()
  })
})
