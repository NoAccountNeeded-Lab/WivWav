import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_MINUTES,
  MAX_WINDOW_MINUTES,
  resolveWindow,
  resolveWindowMinutes,
} from './window.js'

describe('resolveWindowMinutes', () => {
  it('defaults when absent or invalid', () => {
    expect(resolveWindowMinutes(undefined)).toBe(DEFAULT_WINDOW_MINUTES)
    expect(resolveWindowMinutes('abc')).toBe(DEFAULT_WINDOW_MINUTES)
    expect(resolveWindowMinutes('0')).toBe(DEFAULT_WINDOW_MINUTES)
    expect(resolveWindowMinutes('-5')).toBe(DEFAULT_WINDOW_MINUTES)
  })

  it('passes through valid values and clamps to the 24h maximum', () => {
    expect(resolveWindowMinutes('15')).toBe(15)
    expect(resolveWindowMinutes(String(MAX_WINDOW_MINUTES))).toBe(MAX_WINDOW_MINUTES)
    expect(resolveWindowMinutes('999999')).toBe(MAX_WINDOW_MINUTES)
  })
})

describe('resolveWindow', () => {
  it('computes ISO bounds relative to now', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    expect(resolveWindow('30', now)).toEqual({
      minutes: 30,
      sinceMs: now - 30 * 60_000,
      untilMs: now,
      since: '2026-01-01T11:30:00.000Z',
      until: '2026-01-01T12:00:00.000Z',
    })
  })
})
