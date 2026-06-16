import { describe, it, expect } from 'vitest'
import { CRITICAL_JOB_OPTIONS } from './defaults.js'

describe('CRITICAL_JOB_OPTIONS', () => {
  it('sets attempts to 3', () => {
    expect(CRITICAL_JOB_OPTIONS.attempts).toBe(3)
  })

  it('uses exponential backoff', () => {
    expect(CRITICAL_JOB_OPTIONS.backoff?.type).toBe('exponential')
  })

  it('sets backoff delay to 2000ms', () => {
    expect(CRITICAL_JOB_OPTIONS.backoff?.delay).toBe(2000)
  })
})
