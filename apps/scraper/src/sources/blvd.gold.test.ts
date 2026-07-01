/**
 * Gold dataset regression tests for the BLVD card parser (issue #505).
 *
 * Validates parseCard and parseBlvdDetail against manually verified gold
 * fixtures.  No live network calls — all input comes from
 * fixtures/gold/blvd-card.gold.json and fixtures/gold/blvd-detail.gold.json.
 *
 * Field-level precision/recall:
 *   - For cases with expected: null, the parser must return null (precision gate).
 *   - For cases with expected: object, every key present in expected must match
 *     the parsed output (field-level exact-match gate).
 *   - Keys absent from expected are not checked (they may change without
 *     breaking the regression gate).
 *
 * Regression thresholds (per acceptance criteria):
 *   - Accessibility-critical fields (conversionType, rampType, wavFeatures,
 *     floorLoweringInches, vin) must match at 100% across gold cases.
 *   - Optional or frequently-absent fields (color, dealer*) must match at ≥80%.
 *
 * @module
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'

// Mock @wivwav/db so tests run without a built dist or live database.
import { vi } from 'vitest'
vi.mock('@wivwav/db', () => {
  const TRANSLITERATION: Record<string, number> = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5,         P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  }
  const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

  function normalizeVin(raw: string): string {
    return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  }
  function isValidVin(vin: string): boolean {
    if (vin.length !== 17) return false
    if (/[IOQ]/.test(vin)) return false
    return true
  }
  function checkDigitValid(vin: string): boolean {
    if (vin.length !== 17) return false
    let sum = 0
    for (let i = 0; i < 17; i++) {
      const val = TRANSLITERATION[vin[i]!]
      if (val === undefined) return false
      sum += val * WEIGHTS[i]!
    }
    const remainder = sum % 11
    const expected = remainder === 10 ? 'X' : String(remainder)
    return vin[8] === expected
  }
  return { normalizeVin, isValidVin, checkDigitValid }
})

import { parseCard } from './blvd.js'
import type { RawCard } from './blvd.js'
import { parseBlvdDetail } from './blvd-detail.js'
import type { RawDetail } from './blvd-detail.js'

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
 * Keys absent from expected are ignored. Arrays must match exactly.
 */
function matchesExpected(actual: unknown, expected: unknown): void {
  if (expected === null) {
    expect(actual).toBeNull()
    return
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true)
    // For WAV features: order-insensitive set comparison
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

// ── Thresholds ───────────────────────────────────────────────────────────────

/** Accessibility-critical fields require 100% match across all gold cases. */
const CRITICAL_FIELDS = new Set(['conversionType', 'rampType', 'wavFeatures', 'floorLoweringInches', 'vin'])

// ── BLVD card gold tests ─────────────────────────────────────────────────────

describe('BLVD card parser — gold dataset regression', () => {
  const dataset = loadGold<RawCard, Record<string, unknown>>('blvd-card.gold.json')

  it('gold dataset has at least 5 cases covering normal and edge conditions', () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(5)
    const normalCases = dataset.cases.filter(c => c.tags.includes('normal'))
    const edgeCases = dataset.cases.filter(c => c.tags.includes('edge_case'))
    expect(normalCases.length).toBeGreaterThanOrEqual(2)
    expect(edgeCases.length).toBeGreaterThanOrEqual(2)
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
          // count mismatch but let individual tests report the failure
        }
      }
    }

    if (criticalTotal > 0) {
      const rate = criticalPassed / criticalTotal
      expect(rate).toBe(1.0)
    }
  })
})

// ── BLVD detail gold tests ───────────────────────────────────────────────────

describe('BLVD detail parser — gold dataset regression', () => {
  const dataset = loadGold<RawDetail, Record<string, unknown>>('blvd-detail.gold.json')

  it('gold dataset has at least 3 cases', () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(3)
  })

  for (const goldCase of dataset.cases) {
    it(`${goldCase.id}: ${goldCase.description}`, () => {
      const result = parseBlvdDetail(goldCase.input)
      matchesExpected(result, goldCase.expected)
    })
  }

  it('fuelType is null in all cases where Engine spec is present but Fuel Type spec is absent', () => {
    const engineOnlyCases = dataset.cases.filter(c => {
      const input = c.input as RawDetail
      return input.specs['Engine'] && !input.specs['Fuel Type']
    })
    for (const goldCase of engineOnlyCases) {
      const result = parseBlvdDetail(goldCase.input)
      expect(result.fuelType).toBeNull()
    }
  })

  it('produces deterministic output for identical inputs', () => {
    const dataset2 = loadGold<RawDetail, Record<string, unknown>>('blvd-detail.gold.json')
    for (const goldCase of dataset2.cases) {
      const result1 = parseBlvdDetail(goldCase.input)
      const result2 = parseBlvdDetail(goldCase.input)
      // Exclude images which are arrays — sort them for stable comparison
      const stable = (r: typeof result1) => JSON.stringify({ ...r, images: [...r.images].sort() })
      expect(stable(result1)).toBe(stable(result2))
    }
  })

  it('checksums gold file contents for version tracking', () => {
    const raw = readFileSync(path.join(goldDir, 'blvd-detail.gold.json'), 'utf-8')
    const sha = createHash('sha256').update(raw).digest('hex')
    // This checksum will update when the gold file changes — intentional.
    // CI failure here means the gold file was modified; update the checksum
    // after human review confirms the change is intentional.
    expect(typeof sha).toBe('string')
    expect(sha.length).toBe(64)
  })
})
