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
      write: vi.fn((text: string) => order.push(`write ${text.split('\n')[0]}`)),
    },
  }
}

describe('handleUncaughtException', () => {
  it('writes the error to stderr before exiting 1 when Sentry is disabled', () => {
    const { deps, order } = makeDeps(false)
    handleUncaughtException(new Error('Invalid environment configuration. Missing or invalid: X'), deps)
    expect(order).toEqual(['write Error: Invalid environment configuration. Missing or invalid: X', 'exit 1'])
    expect(deps.capture).not.toHaveBeenCalled()
  })

  it('writes, captures and flushes before exiting 1 when Sentry is enabled', async () => {
    const { deps, order } = makeDeps(true)
    handleUncaughtException(new Error('boom'), deps)
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['write Error: boom', 'capture', 'exit 1'])
  })

  it('stringifies non-Error values', () => {
    const { deps } = makeDeps(false)
    handleUncaughtException('plain', deps)
    expect(deps.write).toHaveBeenCalledWith('plain\n')
  })
})
