import { describe, expect, it } from 'vitest'
import { OPERATOR_SETTINGS, resolveOperatorSetting } from './operator-settings.js'

describe('operator settings', () => {
  it('defines all 16 numeric settings', () => {
    expect(Object.keys(OPERATOR_SETTINGS)).toHaveLength(16)
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
})
