import type { BrowserPage } from '../browser/index.js'
import type { ConversionType, FieldMapping, RampType, SaleStatus, WavFeature } from '@wivwav/types'
import { applyFieldTransform } from './field-transforms.js'
import { parseSaleStatus } from '../lib/sale-status.js'

export interface RawDeclarativeField {
  /** Every matched element's extracted (attribute or text) value, trimmed, non-empty, in DOM order. */
  values: string[]
}

/** Raw per-targetField extraction output, keyed by FieldMapping.targetField. */
export type RawDeclarativeDetail = Record<string, RawDeclarativeField>

export interface DeclarativeDetailFields {
  color: string | null
  fuelType: string | null
  engine: string | null
  transmission: string | null
  conversionType: ConversionType
  rampType: RampType
  wavFeatures: WavFeature[]
  floorLoweringInches: number | null
  wheelchairCapacity: number | null
  description: string | null
  images: string[]
  zip: string | null
  dealerPhone: string | null
  saleStatus: SaleStatus
  evidence: {
    color: 'value' | 'missing'
    fuelType: 'value' | 'missing'
    engine: 'value' | 'missing'
    transmission: 'value' | 'missing'
    description: 'value' | 'missing'
    images: 'value' | 'missing'
    /**
     * Independent of `description` — this extractor derives entry-type
     * claims from a structured spec field, not a narrative description
     * block, so it needs its own evidence signal for the #499
     * detail-claims gate (see detail-extract.ts's `claimsObserved`).
     */
    accessibilityClaims: 'value' | 'missing'
  }
}

/**
 * Runs every configured FieldMapping's selector against the current DOM and
 * collects its matched values, verbatim (before any transform is applied).
 *
 * `selector` is interpreted as CSS unless it starts with "/", in which case
 * it is evaluated as XPath — needed because plain CSS has no pseudo-class
 * for matching an element by its text content (e.g. locating a "Label:"
 * cell in a label/value spec block), and XPath's `contains(text(), …)` is
 * the standard, dependency-free way to express that without evaluating
 * arbitrary script (mappings resolve only through the fixed transform
 * library in field-transforms.ts — never `eval`).
 */
export async function evaluateDeclarativeDetail(
  page: BrowserPage,
  mappings: FieldMapping[],
): Promise<RawDeclarativeDetail> {
  return page.evaluate(function (mappings: FieldMapping[]): RawDeclarativeDetail {
    function resolveElements(selector: string): Element[] {
      const trimmed = selector.trim()
      try {
        if (trimmed.startsWith('/')) {
          const result = document.evaluate(
            trimmed,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          )
          const nodes: Element[] = []
          for (let i = 0; i < result.snapshotLength; i++) {
            const node = result.snapshotItem(i)
            if (node instanceof Element) nodes.push(node)
          }
          return nodes
        }
        return Array.from(document.querySelectorAll(trimmed))
      } catch {
        // Malformed selector (bad CSS or bad XPath) — treat as no match
        // rather than failing extraction for every other mapped field.
        return []
      }
    }

    const out: RawDeclarativeDetail = {}
    mappings.forEach(function (mapping) {
      const values = resolveElements(mapping.selector)
        .map(function (el) {
          if (mapping.attribute) return el.getAttribute(mapping.attribute) ?? ''
          return (el as HTMLElement).innerText ?? el.textContent ?? ''
        })
        .map(function (v) { return v.trim() })
        .filter(function (v) { return v.length > 0 })
      out[mapping.targetField] = { values }
    })
    return out
  }, mappings)
}

/**
 * Parses an entry-direction claim from spec text. Mirrors the equivalent
 * per-source parsers (blvd-detail.ts's parseDetailConversionType,
 * mobilityworks-detail.ts's parseMwDetailConversionType) but applied to a
 * structured spec field's value rather than free narrative text.
 */
export function parseDeclarativeConversionType(text: string): ConversionType {
  const t = text.toLowerCase()
  if (t.includes('rear entry') || t.includes('rear-entry')) return 'rear_entry'
  if (t.includes('side entry') || t.includes('side-entry')) return 'side_entry'
  return 'unknown'
}

function firstValue(raw: RawDeclarativeDetail, targetField: string): string | null {
  return raw[targetField]?.values[0] ?? null
}

/**
 * Maps raw per-field matches to the DetailResult-compatible shape, applying
 * each mapping's transform. A targetField with zero matches (selector
 * didn't match on this page, or the field isn't mapped at all in
 * `Source.mappings`) yields 'missing' evidence and a null/empty value — it
 * never falls back to a stale, guessed, or neighboring value, so a
 * structure change that breaks one selector can't silently fabricate data
 * for that field (#822 acceptance criteria).
 */
export function parseDeclarativeDetail(
  raw: RawDeclarativeDetail,
  mappings: FieldMapping[],
): DeclarativeDetailFields {
  const mappingByField = new Map(mappings.map((m) => [m.targetField, m]))

  function textField(targetField: string): string | null {
    const mapping = mappingByField.get(targetField)
    const rawValue = firstValue(raw, targetField)
    if (!mapping || rawValue === null) return null
    const transformed = applyFieldTransform(mapping.transform, rawValue)
    if (transformed === null) return null
    return typeof transformed === 'string' ? transformed : String(transformed)
  }

  const color = textField('color')
  const fuelType = textField('fuelType')
  const engine = textField('engine')
  const transmission = textField('transmission')
  const conversionTypeRaw = textField('conversionType')
  const conversionType: ConversionType = conversionTypeRaw
    ? parseDeclarativeConversionType(conversionTypeRaw)
    : 'unknown'
  const saleStatusRaw = textField('saleStatus')
  const saleStatus: SaleStatus = saleStatusRaw ? parseSaleStatus(saleStatusRaw) : 'active'

  // Unlike BLVD/MobilityWorks' bespoke parsers (whose `galleryFound` flag
  // distinguishes "gallery container not found" from "container found but
  // verified empty," refs #632), a single-selector declarative mapping has
  // no separate "container" concept to check — zero matched elements always
  // means 'missing' (preserve the prior value) here, never
  // 'authoritative_empty' (clear it). This is a strictly safer default for
  // the "must not fabricate values" requirement, at the cost of never
  // auto-clearing a gallery that's genuinely gone to zero photos; that
  // narrower distinction can be added later via a two-mapping (container +
  // items) convention if a source needs it.
  const images = mappingByField.has('images') ? (raw['images']?.values ?? []) : []

  return {
    color,
    fuelType,
    engine,
    transmission,
    conversionType,
    // Freedom Motors' spec block has no in-floor/fold-out/fold-in
    // ramp-deployment text — its "Ramp Operation" field is manual-vs-
    // automatic, a different axis the RampType enum doesn't represent —
    // so this stays unknown for this source until a schema change adds it.
    rampType: 'unknown',
    wavFeatures: [],
    floorLoweringInches: null,
    wheelchairCapacity: null,
    // No narrative description block is mapped in this pass; only
    // structured spec-block fields are.
    description: null,
    images,
    zip: null,
    dealerPhone: null,
    saleStatus,
    evidence: {
      color: color !== null ? 'value' : 'missing',
      fuelType: fuelType !== null ? 'value' : 'missing',
      engine: engine !== null ? 'value' : 'missing',
      transmission: transmission !== null ? 'value' : 'missing',
      description: 'missing',
      images: images.length > 0 ? 'value' : 'missing',
      accessibilityClaims: conversionType !== 'unknown' ? 'value' : 'missing',
    },
  }
}
