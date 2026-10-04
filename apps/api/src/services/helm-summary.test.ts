import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectHelmSummary } from './helm-summary.js'

const ok = (n: number) => async () => n

describe('collectHelmSummary deadlines', () => {
  const unhandled = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    process.on('unhandledRejection', unhandled)
  })
  afterEach(() => {
    process.off('unhandledRejection', unhandled)
    unhandled.mockClear()
    vi.useRealTimers()
  })

  it('returns unavailable for a never-settling reading and keeps healthy counts', async () => {
    let seen: AbortSignal | undefined
    const pending = collectHelmSummary({
      countStored: ok(10),
      countActive: ok(8),
      countEligible: ok(5),
      countIndexed: signal => {
        seen = signal
        return new Promise<number>(() => {})
      },
      readingTimeoutMs: 100,
    })
    await vi.advanceTimersByTimeAsync(100)
    const data = await pending

    expect(data.counts.stored.value).toBe(10)
    expect(data.counts.eligible.value).toBe(5)
    expect(data.counts.indexed).toEqual({ value: null, availability: 'unavailable', collectedAt: null })
    expect(data.availability).toEqual({ database: 'available', search: 'unavailable' })
    expect(seen?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('marks database unavailable when a database reading stalls', async () => {
    const pending = collectHelmSummary({
      countStored: () => new Promise<number>(() => {}),
      countActive: ok(8),
      countEligible: ok(5),
      countIndexed: ok(7),
      readingTimeoutMs: 100,
    })
    await vi.advanceTimersByTimeAsync(100)
    const data = await pending

    expect(data.counts.stored.value).toBeNull()
    expect(data.counts.active.value).toBe(8)
    expect(data.counts.indexed.value).toBe(7)
    expect(data.availability).toEqual({ database: 'unavailable', search: 'available' })
  })

  it('does not leak an unhandled rejection when a timed-out reading rejects late', async () => {
    let rejectLate: (e: Error) => void = () => {}
    const pending = collectHelmSummary({
      countStored: () => new Promise<number>((_, reject) => { rejectLate = reject }),
      countActive: ok(1),
      countEligible: ok(1),
      countIndexed: ok(1),
      readingTimeoutMs: 100,
    })
    await vi.advanceTimersByTimeAsync(100)
    await pending
    rejectLate(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(10)
    await Promise.resolve()

    expect(unhandled).not.toHaveBeenCalled()
  })

  it('clears timers when readings settle before the deadline', async () => {
    await collectHelmSummary({ countStored: ok(1), countActive: ok(1), countEligible: ok(1), countIndexed: ok(1) })
    expect(vi.getTimerCount()).toBe(0)
  })
})
