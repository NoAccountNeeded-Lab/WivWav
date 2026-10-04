import { describe, expect, it } from 'vitest'
import { EscalateCapabilitySignal, isEscalateCapabilitySignal } from './escalate-capability-signal.js'
import { RetryJobSignal } from './retry-signal.js'

describe('EscalateCapabilitySignal', () => {
  it('carries capability and reason and is an Error', () => {
    const signal = new EscalateCapabilitySignal('chromium', 'http blocked')
    expect(signal).toBeInstanceOf(Error)
    expect(signal.capability).toBe('chromium')
    expect(signal.reason).toBe('http blocked')
    expect(signal.name).toBe('EscalateCapabilitySignal')
  })

  it('is distinct from RetryJobSignal', () => {
    expect(new EscalateCapabilitySignal('chromium', 'x')).not.toBeInstanceOf(RetryJobSignal)
    expect(isEscalateCapabilitySignal(new RetryJobSignal(1))).toBe(false)
  })

  it('isEscalateCapabilitySignal matches by shape across module instances', () => {
    const foreign = Object.assign(new Error('x'), {
      name: 'EscalateCapabilitySignal',
      capability: 'chromium',
      reason: 'blocked',
    })
    expect(isEscalateCapabilitySignal(foreign)).toBe(true)
    expect(isEscalateCapabilitySignal(new Error('boom'))).toBe(false)
    expect(isEscalateCapabilitySignal('chromium')).toBe(false)
  })
})
