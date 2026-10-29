import { describe, expect, it } from 'vitest'
import { OPERATOR_SETTING_GROUPS, OPERATOR_SETTINGS, resolveOperatorSetting } from './operator-settings.js'

describe('operator settings', () => {
  it('defines the existing settings and all 14 new operator settings', () => {
    expect(Object.keys(OPERATOR_SETTINGS)).toHaveLength(30)
  })
  it('assigns every registry key to exactly one described group', () => {
    const keys = Object.keys(OPERATOR_SETTINGS)
    const memberships = keys.map((key) => {
      const definition = OPERATOR_SETTINGS[key as keyof typeof OPERATOR_SETTINGS]
      const group = OPERATOR_SETTING_GROUPS[definition.group]
      expect(group.label.length).toBeGreaterThan(0)
      expect(group.description.length).toBeGreaterThan(0)
      return key
    })
    expect(memberships).toHaveLength(keys.length)
    expect(new Set(memberships).size).toBe(keys.length)
  })
  it('declares an inline unit for millisecond, second, and day settings', () => {
    for (const [key, definition] of Object.entries(OPERATOR_SETTINGS)) {
      if (key.endsWith('_ms')) expect('unit' in definition && definition.unit).toBe('ms')
      if (key.endsWith('_s')) expect('unit' in definition && definition.unit).toBe('s')
      if (key.endsWith('_days')) expect('unit' in definition && definition.unit).toBe('days')
    }
  })
  it('uses the default for missing, tombstoned and wrong-type rows', () => {
    expect(resolveOperatorSetting('detail_crawl.batch_size', null)).toBe(50)
    expect(resolveOperatorSetting('detail_crawl.batch_size', { value: null, type: 'number' })).toBe(50)
    expect(resolveOperatorSetting('detail_crawl.batch_size', { value: '400', type: 'string' })).toBe(50)
  })
  it('clamps at both bounds', () => {
    expect(resolveOperatorSetting('detail_crawl.batch_size', { value: -1, type: 'number' })).toBe(1)
    expect(resolveOperatorSetting('detail_crawl.batch_size', { value: 10000, type: 'number' })).toBe(500)
  })

  it.each([
    ['quality.systemic_error_threshold', 0.2, 0.05, 0.8],
    ['quality.drift_threshold_pp', 0.15, 0.05, 0.5],
    ['quality.systemic_min_listings', 5, 1, 100],
    ['semantic_evidence.min_confidence', 0.85, 0, 1],
    ['facets.cache_ttl_s', 60, 0, 3600],
    ['health.latency_ms.postgres', 100, 20, 5000],
    ['health.latency_ms.meilisearch', 150, 20, 5000],
    ['health.latency_ms.valkey', 100, 20, 5000],
    ['health.latency_ms.ollama', 750, 20, 5000],
    ['listings.refresh_cooldown_min', 60, 5, 1440],
    ['gateway.escalation_wait_min', 60, 5, 240],
    ['worker.job_timeout_min', 45, 5, 180],
    ['listing.gone_after_missing', 6, 2, 50],
  ] as const)('uses defaults and clamps %s', (key, defaultValue, min, max) => {
    expect(resolveOperatorSetting(key, null)).toBe(defaultValue)
    expect(resolveOperatorSetting(key, { value: null, type: 'number' })).toBe(defaultValue)
    expect(resolveOperatorSetting(key, { value: min - 1, type: 'number' })).toBe(min)
    expect(resolveOperatorSetting(key, { value: max + 1, type: 'number' })).toBe(max)
  })

  it('accepts finite decimal values for float settings', () => {
    expect(resolveOperatorSetting('quality.systemic_error_threshold', { value: 0.25, type: 'number' })).toBe(0.25)
    expect(resolveOperatorSetting('semantic_evidence.min_confidence', { value: 0.875, type: 'number' })).toBe(0.875)
  })

  it('uses the supplied fallback for tombstoned and invalid values', () => {
    expect(resolveOperatorSetting('worker.job_timeout_min', { value: null, type: 'number' }, 90)).toBe(90)
    expect(resolveOperatorSetting('worker.job_timeout_min', { value: '90', type: 'string' }, 75)).toBe(75)
    expect(resolveOperatorSetting('worker.job_timeout_min', { value: 999, type: 'number' }, 200)).toBe(180)
  })

  it('resolves the strict publish gate as a boolean and preserves its fallback', () => {
    expect(resolveOperatorSetting('publish_gate.strict', null)).toBe(false)
    expect(resolveOperatorSetting('publish_gate.strict', { value: true, type: 'boolean' })).toBe(true)
    expect(resolveOperatorSetting('publish_gate.strict', { value: null, type: 'boolean' }, true)).toBe(true)
    expect(resolveOperatorSetting('publish_gate.strict', { value: 'true', type: 'string' })).toBe(false)
  })
})
