import { describe, it, expect, vi } from 'vitest'
import { handleUncaughtException } from './uncaught-exception.js'

function makeDeps(sentryEnabled: boolean) {
  const order: string[] = []
  return {
    order,
    deps: {
      sentryEnabled,
      capture: vi.fn(() => order.push('capture')),
      flush: vi.fn(() => Promise.resolve()),
      exit: vi.fn((code: number) => order.push(`exit ${code}`)),
      write: vi.fn((text: string) => order.push(`write ${text}`)),
    },
  }
}

describe('handleUncaughtException', () => {
  it('writes the error to stderr before exiting 1 when Sentry is disabled', () => {
    const { deps, order } = makeDeps(false)
    const err = new Error('Invalid environment configuration. Missing or invalid: X')
    handleUncaughtException(err, deps)
    expect(order).toEqual([`write ${err.stack}\n`, 'exit 1'])
    expect(deps.capture).not.toHaveBeenCalled()
  })

  it('writes, captures and flushes before exiting 1 when Sentry is enabled', async () => {
    const { deps, order } = makeDeps(true)
    let release!: () => void
    deps.flush.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    const err = new Error('boom')
    handleUncaughtException(err, deps)
    expect(order).toEqual([`write ${err.stack}\n`, 'capture'])
    release()
    await vi.waitFor(() => expect(order).toContain('exit 1'))
    expect(order.at(-1)).toBe('exit 1')
  })

  it('stringifies non-Error values', () => {
    const { deps } = makeDeps(false)
    handleUncaughtException('plain', deps)
    expect(deps.write).toHaveBeenCalledWith('plain\n')
  })
})
