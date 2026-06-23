import { describe, it, expect, vi, afterEach } from 'vitest'
import { jitteredSleep } from './jitter-sleep.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('jitteredSleep', () => {
  it('resolves after a non-negative delay', async () => {
    const start = Date.now()
    await jitteredSleep(10)
    const elapsed = Date.now() - start
    // Allow generous headroom for CI scheduling jitter
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it('stays within ±20% of the base delay', async () => {
    const delays: number[] = []
    // Capture the actual setTimeout delay by intercepting the call
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      delays.push(ms as number)
      ;(fn as () => void)()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    for (let i = 0; i < 50; i++) {
      await jitteredSleep(1000)
    }

    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(800) // 1000 * (1 - 0.2)
      expect(d).toBeLessThanOrEqual(1200)   // 1000 * (1 + 0.2)
    }
  })

  it('never produces a negative delay', async () => {
    const delays: number[] = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      delays.push(ms as number)
      ;(fn as () => void)()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    for (let i = 0; i < 20; i++) {
      await jitteredSleep(0)
    }

    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(0)
    }
  })

  it('applies a custom factor', async () => {
    const delays: number[] = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      delays.push(ms as number)
      ;(fn as () => void)()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    for (let i = 0; i < 50; i++) {
      await jitteredSleep(1000, 0.5)
    }

    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(500)  // 1000 * (1 - 0.5)
      expect(d).toBeLessThanOrEqual(1500)    // 1000 * (1 + 0.5)
    }
  })
})
