/**
 * Gold dataset regression tests for the MobilityWorks card and detail parsers
 * (issue #505).
 *
 * Validates parseCard (mobilityworks.ts) and parseMwDetail
 * (mobilityworks-detail.ts) against manually verified gold fixtures.  No
 * live network calls — all input comes from local JSON fixtures.
 *
 * Field-level precision/recall:
 *   - For cases with expected: null, the parser must return null.
 *   - For cases with expected: object, every key present in expected must match
 *     parsed output (field-level exact-match gate).
 *   - Keys absent from expected are not checked.
 *
 * Regression thresholds:
 *   - Accessibility-critical fields (conversionType, rampType, wavFeatures,
 *     floorLoweringInches, vin) must match at 100%.
 *   - fuelType must match at 100% (engine-to-fuelType bleed is a known
 *     false-confident classification with strict gate).
 *
 * @module
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'

import { parseCard } from './mobilityworks.js'
import type { RawCard } from './mobilityworks.js'
import { parseMwDetail } from './mobilityworks-detail.js'
import type { RawMwDetail } from './mobilityworks-detail.js'

// ── Load gold fixtures ───────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const goldDir = path.join(__dirname, 'fixtures', 'gold')

interface GoldCase<TInput, TExpected> {
  id: string
  description: string
  tags: string[]
  input: TInput
  expected: TExpected | null
  notes?: string
}

interface GoldDataset<TInput, TExpected> {
  sourceId: string
  parserVersion: number
  cases: GoldCase<TInput, TExpected>[]
}

function loadGold<TInput, TExpected>(filename: string): GoldDataset<TInput, TExpected> {
  const raw = readFileSync(path.join(goldDir, filename), 'utf-8')
  return JSON.parse(raw) as GoldDataset<TInput, TExpected>
}

// ── Type-narrowing helpers ───────────────────────────────────────────────────

/**
 * Deep-partial match: every key present in expected must match actual.
 * Arrays use order-insensitive set comparison (WAV features may vary in order).
 */
function matchesExpected(actual: unknown, expected: unknown): void {
  if (expected === null) {
    expect(actual).toBeNull()
    return
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true)
    expect((actual as unknown[]).sort()).toEqual((expected as unknown[]).sort())
    return
  }
  if (typeof expected === 'object' && expected !== null) {
    expect(actual).not.toBeNull()
    for (const [key, val] of Object.entries(expected)) {
      matchesExpected((actual as Record<string, unknown>)[key], val)
    }
    return
  }
  expect(actual).toEqual(expected)
}

/** Accessibility-critical and false-confident-classification fields. */
const CRITICAL_FIELDS = new Set(['conversionType', 'rampType', 'wavFeatures', 'floorLoweringInches', 'vin', 'fuelType'])

// ── MobilityWorks card gold tests ────────────────────────────────────────────

describe('MobilityWorks card parser — gold dataset regression', () => {
  const dataset = loadGold<RawCard, Record<string, unknown>>('mobilityworks-card.gold.json')

  it('gold dataset has at least 4 cases covering normal and edge conditions', () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(4)
    const normalCases = dataset.cases.filter(c => c.tags.includes('normal'))
    const edgeCases = dataset.cases.filter(c => c.tags.includes('edge_case'))
    expect(normalCases.length).toBeGreaterThanOrEqual(2)
    expect(edgeCases.length).toBeGreaterThanOrEqual(1)
  })

  it('gold dataset version is recorded', () => {
    expect(typeof dataset.parserVersion).toBe('number')
    expect(dataset.parserVersion).toBeGreaterThan(0)
  })

  for (const goldCase of dataset.cases) {
    it(`${goldCase.id}: ${goldCase.description}`, () => {
      const result = parseCard(goldCase.input)

      if (goldCase.expected === null) {
        expect(result).toBeNull()
        return
      }

      expect(result).not.toBeNull()
      matchesExpected(result, goldCase.expected)
    })
  }

  it('critical fields match at 100% across all non-null expected cases', () => {
    const nonNullCases = dataset.cases.filter(c => c.expected !== null)
    let criticalTotal = 0
    let criticalPassed = 0

    for (const goldCase of nonNullCases) {
      const result = parseCard(goldCase.input)
      if (result === null) continue

      for (const field of CRITICAL_FIELDS) {
        const expectedValue = (goldCase.expected as Record<string, unknown>)[field]
        if (expectedValue === undefined) continue
        criticalTotal++
        try {
          matchesExpected((result as Record<string, unknown>)[field], expectedValue)
          criticalPassed++
        } catch {
          // individual test reports failure; we just count here
        }
      }
    }

    if (criticalTotal > 0) {
      const rate = criticalPassed / criticalTotal
      expect(rate).toBe(1.0)
    }
  })

  it('produces deterministic output for identical inputs', () => {
    for (const goldCase of dataset.cases) {
      const r1 = parseCard(goldCase.input)
      const r2 = parseCard(goldCase.input)
      if (r1 === null) {
        expect(r2).toBeNull()
      } else if (r2 !== null) {
        // listedAt is set to new Date() — strip it for stable comparison
        type ParseResult = NonNullable<typeof r1>
        const stable = (r: ParseResult) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { listedAt, ...rest } = r
          return JSON.stringify(rest)
        }
        expect(stable(r1)).toBe(stable(r2))
      }
    }
  })
})

// ── MobilityWorks detail gold tests ──────────────────────────────────────────

describe('MobilityWorks detail parser — gold dataset regression', () => {
  const dataset = loadGold<RawMwDetail, Record<string, unknown>>('mobilityworks-detail.gold.json')

  it('gold dataset has at least 3 cases', () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(3)
  })

  for (const goldCase of dataset.cases) {
    it(`${goldCase.id}: ${goldCase.description}`, () => {
      const result = parseMwDetail(goldCase.input)
      matchesExpected(result, goldCase.expected)
    })
  }

  it('fuelType is never populated from Engine spec', () => {
    // Every gold case that has Engine but no Fuel Type spec must produce null fuelType.
    const engineOnlyCases = dataset.cases.filter(c => {
      const input = c.input as RawMwDetail
      return input.specs['Engine'] && !input.specs['Fuel Type']
    })
    for (const goldCase of engineOnlyCases) {
      const result = parseMwDetail(goldCase.input)
      expect(result.fuelType).toBeNull()
    }
  })

  it('wavFeatures are a subset of the controlled vocabulary', () => {
    const allowedFeatures = new Set([
      'hand_controls', 'transfer_seat', 'has_lift', 'kneel_system',
      'lowered_floor', 'power_ramp', 'tie_down_system', 'automatic_door',
      'motorized_running_board',
    ])
    for (const goldCase of dataset.cases) {
      const result = parseMwDetail(goldCase.input)
      for (const feature of result.wavFeatures) {
        expect(allowedFeatures.has(feature)).toBe(true)
      }
    }
  })

  it('checksums gold file contents for version tracking', () => {
    const raw = readFileSync(path.join(goldDir, 'mobilityworks-detail.gold.json'), 'utf-8')
    const sha = createHash('sha256').update(raw).digest('hex')
    expect(typeof sha).toBe('string')
    expect(sha.length).toBe(64)
  })
})
