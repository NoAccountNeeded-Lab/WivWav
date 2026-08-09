import { describe, expect, it } from 'vitest'
import {
  isWorkerGatewayEnabled,
  resolveScraperRuntimeMode,
  shouldRegisterSchedules,
  shouldStartWorkers,
} from './runtime-mode.js'

describe('resolveScraperRuntimeMode', () => {
  it('defaults to all when unset', () => {
    expect(resolveScraperRuntimeMode()).toBe('all')
  })

  it.each(['all', 'scheduler', 'worker'] as const)('accepts %s', (value) => {
    expect(resolveScraperRuntimeMode(value)).toBe(value)
  })

  it('rejects unknown runtime modes', () => {
    expect(() => resolveScraperRuntimeMode('bad-mode')).toThrow(
      'Invalid SCRAPER_RUNTIME_MODE "bad-mode"',
    )
  })
})

describe('runtime mode gates', () => {
  it('runs everything in all mode', () => {
    expect(shouldRegisterSchedules('all')).toBe(true)
    expect(shouldStartWorkers('all')).toBe(true)
  })

  it('only registers schedules in scheduler mode', () => {
    expect(shouldRegisterSchedules('scheduler')).toBe(true)
    expect(shouldStartWorkers('scheduler')).toBe(false)
  })

  it('only starts workers in worker mode', () => {
    expect(shouldRegisterSchedules('worker')).toBe(false)
    expect(shouldStartWorkers('worker')).toBe(true)
  })
})

describe('isWorkerGatewayEnabled', () => {
  it('defaults to false when unset', () => {
    expect(isWorkerGatewayEnabled(undefined)).toBe(false)
  })

  it('is false for any value other than the literal string "true"', () => {
    expect(isWorkerGatewayEnabled('false')).toBe(false)
    expect(isWorkerGatewayEnabled('1')).toBe(false)
    expect(isWorkerGatewayEnabled('')).toBe(false)
  })

  it('is true only for the literal string "true"', () => {
    expect(isWorkerGatewayEnabled('true')).toBe(true)
  })
})
