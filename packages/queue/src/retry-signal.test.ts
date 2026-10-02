import { describe, expect, it } from 'vitest'
import { RetryJobSignal } from './retry-signal.js'

describe('RetryJobSignal', () => {
  it('carries the requeue delay and a default message', () => {
    const signal = new RetryJobSignal(5_000)
    expect(signal.delayMs).toBe(5_000)
    expect(signal.message).toBe('job requeued by processor retry signal')
    expect(signal.name).toBe('RetryJobSignal')
  })

  it('accepts a custom message', () => {
    expect(new RetryJobSignal(1, 'no worker connected').message).toBe('no worker connected')
  })

  it('is an Error so processors can throw it', () => {
    expect(new RetryJobSignal(0)).toBeInstanceOf(Error)
  })
})
