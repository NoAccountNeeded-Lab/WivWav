import { describe, expect, it, vi } from 'vitest'

import type * as QueueModule from '@wivwav/queue'

vi.mock('@wivwav/queue', async () => {
  const actual = await vi.importActual<typeof QueueModule>('@wivwav/queue')
  return {
    ...actual,
    BullMQQueueFactory: vi.fn().mockImplementation(function (this: unknown) {
      return { createQueue: vi.fn() }
    }),
  }
})

describe('getQueueFactory', () => {
  it('returns a QueueFactory instance', async () => {
    const { getQueueFactory } = await import('./queue-factory.js')
    const factory = getQueueFactory()
    expect(factory).toBeDefined()
    expect(typeof factory.createQueue).toBe('function')
  })

  it('returns the same instance on repeated calls (singleton)', async () => {
    const { getQueueFactory } = await import('./queue-factory.js')
    const first = getQueueFactory()
    const second = getQueueFactory()
    expect(first).toBe(second)
  })
})
