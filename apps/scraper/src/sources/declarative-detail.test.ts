import { describe, it, expect } from 'vitest'
import type { FieldMapping } from '@wivwav/types'
import { parseDeclarativeDetail, parseDeclarativeConversionType } from './declarative-detail.js'
import type { RawDeclarativeDetail } from './declarative-detail.js'

function mapping(overrides: Partial<FieldMapping> & { targetField: string }): FieldMapping {
  return { selector: '.placeholder', attribute: null, transform: null, ...overrides }
}

// ─── parseDeclarativeConversionType ──────────────────────────────────────────

describe('parseDeclarativeConversionType', () => {
  it('detects rear entry', () => {
    expect(parseDeclarativeConversionType('Rear Entry Full-Cut')).toBe('rear_entry')
  })

  it('detects side entry', () => {
    expect(parseDeclarativeConversionType('Side Entry')).toBe('side_entry')
  })

  it('returns unknown when no entry phrase is present', () => {
    expect(parseDeclarativeConversionType('')).toBe('unknown')
    expect(parseDeclarativeConversionType('Handicap Accessible Van')).toBe('unknown')
  })
})

// ─── parseDeclarativeDetail ───────────────────────────────────────────────────

const baseMappings: FieldMapping[] = [
  mapping({ targetField: 'images', selector: '.gallery img', attribute: 'data-large_image' }),
  mapping({ targetField: 'color', selector: '//span[1]', transform: 'trimText' }),
  mapping({ targetField: 'fuelType', selector: '//span[2]', transform: 'trimText' }),
  mapping({ targetField: 'engine', selector: '//span[3]', transform: 'trimText' }),
  mapping({ targetField: 'transmission', selector: '//span[4]', transform: 'trimText' }),
  mapping({ targetField: 'conversionType', selector: '//span[5]', transform: 'trimText' }),
  mapping({ targetField: 'saleStatus', selector: '//span[6]', transform: 'trimText' }),
]

const fullRaw: RawDeclarativeDetail = {
  images: { values: ['https://example.com/1.jpg', 'https://example.com/2.jpg'] },
  color: { values: ['Ebony Black'] },
  fuelType: { values: ['Gasoline Fuel'] },
  engine: { values: ['Regular Unleaded V-6 3.8 L/231'] },
  transmission: { values: ['8-Speed Automatic w/OD'] },
  conversionType: { values: ['Rear Entry Full-Cut'] },
  saleStatus: { values: ['Available, Marketing Featured'] },
}

describe('parseDeclarativeDetail — full match', () => {
  it('extracts every mapped field with value evidence', () => {
    const result = parseDeclarativeDetail(fullRaw, baseMappings)
    expect(result.color).toBe('Ebony Black')
    expect(result.fuelType).toBe('Gasoline Fuel')
    expect(result.engine).toBe('Regular Unleaded V-6 3.8 L/231')
    expect(result.transmission).toBe('8-Speed Automatic w/OD')
    expect(result.images).toEqual(['https://example.com/1.jpg', 'https://example.com/2.jpg'])
    expect(result.evidence).toMatchObject({
      color: 'value',
      fuelType: 'value',
      engine: 'value',
      transmission: 'value',
      images: 'value',
    })
  })

  it('derives conversionType from the mapped spec text', () => {
    expect(parseDeclarativeDetail(fullRaw, baseMappings).conversionType).toBe('rear_entry')
  })

  it('derives saleStatus from the mapped spec text', () => {
    expect(parseDeclarativeDetail(fullRaw, baseMappings).saleStatus).toBe('active')
  })

  it('reports sold saleStatus when the mapped status text says Sold', () => {
    const raw: RawDeclarativeDetail = { ...fullRaw, saleStatus: { values: ['Sold'] } }
    expect(parseDeclarativeDetail(raw, baseMappings).saleStatus).toBe('sold')
  })

  it('records accessibilityClaims evidence when a conversionType claim was found', () => {
    expect(parseDeclarativeDetail(fullRaw, baseMappings).evidence.accessibilityClaims).toBe('value')
  })

  it('never populates rampType — Freedom Motors has no ramp-deployment text', () => {
    expect(parseDeclarativeDetail(fullRaw, baseMappings).rampType).toBe('unknown')
  })

  it('never populates a narrative description in this pass', () => {
    const result = parseDeclarativeDetail(fullRaw, baseMappings)
    expect(result.description).toBeNull()
    expect(result.evidence.description).toBe('missing')
  })
})

describe('parseDeclarativeDetail — missing-field path (selector fails to match)', () => {
  it('returns null and missing evidence for a field whose selector matched nothing — does not fabricate a value', () => {
    const raw: RawDeclarativeDetail = { ...fullRaw, fuelType: { values: [] } }
    const result = parseDeclarativeDetail(raw, baseMappings)
    expect(result.fuelType).toBeNull()
    expect(result.evidence.fuelType).toBe('missing')
    // Other fields are unaffected by the one missing field.
    expect(result.color).toBe('Ebony Black')
  })

  it('returns null and missing evidence for a targetField absent from Source.mappings entirely', () => {
    const mappingsWithoutColor = baseMappings.filter((m) => m.targetField !== 'color')
    const result = parseDeclarativeDetail(fullRaw, mappingsWithoutColor)
    expect(result.color).toBeNull()
    expect(result.evidence.color).toBe('missing')
  })

  it('returns empty images and missing evidence when the images mapping is absent', () => {
    const mappingsWithoutImages = baseMappings.filter((m) => m.targetField !== 'images')
    const result = parseDeclarativeDetail(fullRaw, mappingsWithoutImages)
    expect(result.images).toEqual([])
    expect(result.evidence.images).toBe('missing')
  })

  it('returns unknown conversionType and missing accessibilityClaims evidence when no entry text matched', () => {
    const raw: RawDeclarativeDetail = { ...fullRaw, conversionType: { values: [] } }
    const result = parseDeclarativeDetail(raw, baseMappings)
    expect(result.conversionType).toBe('unknown')
    expect(result.evidence.accessibilityClaims).toBe('missing')
  })

  it('defaults saleStatus to active (not fabricated as sold/gone) when the status mapping fails to match', () => {
    const raw: RawDeclarativeDetail = { ...fullRaw, saleStatus: { values: [] } }
    expect(parseDeclarativeDetail(raw, baseMappings).saleStatus).toBe('active')
  })
})

describe('parseDeclarativeDetail — mapping-driven behavior (#822: no code change or redeploy)', () => {
  it('changes extraction output when only the mappings array changes, with identical raw DOM extraction inputs', () => {
    // Same underlying page, same evaluateDeclarativeDetail output shape — the
    // ONLY thing that changes between these two calls is the mappings config,
    // exactly like updating the `Source.mappings` DB row would.
    const rawFromV1Selectors: RawDeclarativeDetail = {
      color: { values: ['Ebony Black'] },
    }
    const v1Mappings: FieldMapping[] = [mapping({ targetField: 'color', selector: '.v1-color' })]
    const v2Mappings: FieldMapping[] = [mapping({ targetField: 'paintColor', selector: '.v2-paint-color' })]

    const v1Result = parseDeclarativeDetail(rawFromV1Selectors, v1Mappings)
    expect(v1Result.color).toBe('Ebony Black')

    // v2 mappings rename the target field — the same raw extraction bucket
    // ('color') is no longer wired to anything, so the parsed color is now
    // missing, purely from the config change.
    const v2Result = parseDeclarativeDetail(rawFromV1Selectors, v2Mappings)
    expect(v2Result.color).toBeNull()
    expect(v2Result.evidence.color).toBe('missing')
  })
})
