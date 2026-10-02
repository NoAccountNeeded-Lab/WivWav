import { describe, expect, it, vi } from 'vitest'
import { isTransientPrismaError, withTransientRetry } from './db-retry.js'

describe('isTransientPrismaError', () => {
  it.each(['P2002', 'P2028', 'P2034', 'P1001', 'P1002', 'P1008', 'P1017'])('treats %s as transient', (code) => {
    expect(isTransientPrismaError({ code })).toBe(true)
  })

  it('treats known connection messages as transient (case-insensitive)', () => {
    expect(isTransientPrismaError(new Error('Connection CLOSED by peer'))).toBe(true)
    expect(isTransientPrismaError(new Error('connection reset'))).toBe(true)
    expect(isTransientPrismaError(new Error('Transaction not found'))).toBe(true)
    expect(isTransientPrismaError(new Error('Transaction already closed'))).toBe(true)
  })

  it('rejects other errors and non-objects', () => {
    expect(isTransientPrismaError({ code: 'P2025' })).toBe(false)
    expect(isTransientPrismaError(new Error('syntax error'))).toBe(false)
    expect(isTransientPrismaError({})).toBe(false)
    expect(isTransientPrismaError(null)).toBe(false)
    expect(isTransientPrismaError('connection closed')).toBe(false)
  })
})

describe('withTransientRetry', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await withTransientRetry(fn)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries transient errors then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce({ code: 'P2034' }).mockResolvedValue('ok')
    expect(await withTransientRetry(fn, 3, 1)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-transient errors', async () => {
    const err = new Error('boom')
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withTransientRetry(fn, 3, 1)).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up after maxAttempts and rethrows', async () => {
    const err = { code: 'P1001' }
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withTransientRetry(fn, 3, 1)).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
