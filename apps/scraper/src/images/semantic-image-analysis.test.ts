import { describe, it, expect } from 'vitest'
import { validateImageAnalysisResult, CURRENT_SEMANTIC_ANALYSIS_VERSION } from './semantic-image-analysis.js'

describe('validateImageAnalysisResult', () => {
  it('should accept a well-formed result', () => {
    const result = validateImageAnalysisResult({
      schemaVersion: '1',
      altText: 'A wheelchair ramp deployed at the side door.',
      summary: 'Side-entry ramp visible.',
      labels: [{ label: 'ramp', confidence: 0.91 }],
      fieldClaims: [{ field: 'rampType', claimedValue: 'side_entry', confidence: 0.91 }],
    })
    expect(result).not.toBeNull()
    expect(result?.labels).toEqual([{ label: 'ramp', confidence: 0.91 }])
  })

  it('should accept null altText and summary', () => {
    const result = validateImageAnalysisResult({
      schemaVersion: '1',
      altText: null,
      summary: null,
      labels: [],
      fieldClaims: [],
    })
    expect(result).not.toBeNull()
  })

  it('should reject a non-object payload', () => {
    expect(validateImageAnalysisResult('not an object')).toBeNull()
    expect(validateImageAnalysisResult(null)).toBeNull()
    expect(validateImageAnalysisResult(undefined)).toBeNull()
  })

  it('should reject a missing schemaVersion', () => {
    expect(
      validateImageAnalysisResult({ altText: null, summary: null, labels: [], fieldClaims: [] }),
    ).toBeNull()
  })

  it('should reject an unknown label', () => {
    expect(
      validateImageAnalysisResult({
        schemaVersion: '1',
        altText: null,
        summary: null,
        labels: [{ label: 'not_a_real_label', confidence: 0.5 }],
        fieldClaims: [],
      }),
    ).toBeNull()
  })

  it('should reject a confidence outside [0, 1]', () => {
    expect(
      validateImageAnalysisResult({
        schemaVersion: '1',
        altText: null,
        summary: null,
        labels: [{ label: 'ramp', confidence: 1.5 }],
        fieldClaims: [],
      }),
    ).toBeNull()
  })

  it('should reject a non-numeric confidence', () => {
    expect(
      validateImageAnalysisResult({
        schemaVersion: '1',
        altText: null,
        summary: null,
        labels: [{ label: 'ramp', confidence: 'high' }],
        fieldClaims: [],
      }),
    ).toBeNull()
  })

  it('should reject an unknown fieldClaims field', () => {
    expect(
      validateImageAnalysisResult({
        schemaVersion: '1',
        altText: null,
        summary: null,
        labels: [],
        fieldClaims: [{ field: 'notAField', claimedValue: 'x', confidence: 0.5 }],
      }),
    ).toBeNull()
  })

  it('should reject when labels is not an array', () => {
    expect(
      validateImageAnalysisResult({ schemaVersion: '1', altText: null, summary: null, labels: 'ramp', fieldClaims: [] }),
    ).toBeNull()
  })
})

describe('CURRENT_SEMANTIC_ANALYSIS_VERSION', () => {
  it('should be a positive integer', () => {
    expect(Number.isInteger(CURRENT_SEMANTIC_ANALYSIS_VERSION)).toBe(true)
    expect(CURRENT_SEMANTIC_ANALYSIS_VERSION).toBeGreaterThan(0)
  })
})
