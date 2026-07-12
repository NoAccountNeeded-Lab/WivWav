// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import type { MouseEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useViewTransitionNav } from './useViewTransitionNav'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

function clickEvent(overrides: Partial<MouseEvent<HTMLAnchorElement>> = {}): MouseEvent<HTMLAnchorElement> {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as MouseEvent<HTMLAnchorElement>
}

// jsdom implements neither `document.startViewTransition` nor
// `window.matchMedia`, so each test installs/removes them directly on the
// real globals rather than replacing `document`/`window` wholesale (a
// wholesale replacement drops the DOM prototype methods Testing Library's
// `render` needs and breaks every test with an unrelated `appendChild` error).
function stubStartViewTransition(impl?: (callback: () => void) => ViewTransition): void {
  Object.defineProperty(document, 'startViewTransition', {
    value: impl,
    configurable: true,
  })
}

function stubMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches }),
    configurable: true,
  })
}

afterEach(() => {
  vi.clearAllMocks()
  delete (document as { startViewTransition?: unknown }).startViewTransition
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('useViewTransitionNav', () => {
  it('starts a view transition and navigates on an unmodified primary click when the API is supported', () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      return {} as ViewTransition
    })
    stubStartViewTransition(startViewTransition)
    stubMatchMedia(false)

    const { result } = renderHook(() => useViewTransitionNav())
    const event = clickEvent()
    result.current(event, '/ops/queues')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(startViewTransition).toHaveBeenCalledOnce()
    expect(mockPush).toHaveBeenCalledWith('/ops/queues')
  })

  it('falls through to default Link navigation when the browser has no startViewTransition support', () => {
    stubStartViewTransition(undefined)

    const { result } = renderHook(() => useViewTransitionNav())
    const event = clickEvent()
    result.current(event, '/ops/queues')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('falls through to default Link navigation under prefers-reduced-motion: reduce', () => {
    const startViewTransition = vi.fn()
    stubStartViewTransition(startViewTransition)
    stubMatchMedia(true)

    const { result } = renderHook(() => useViewTransitionNav())
    const event = clickEvent()
    result.current(event, '/ops/queues')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('ignores modified clicks (new-tab intents) so the browser handles them natively', () => {
    const startViewTransition = vi.fn()
    stubStartViewTransition(startViewTransition)
    stubMatchMedia(false)

    const { result } = renderHook(() => useViewTransitionNav())

    for (const overrides of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const event = clickEvent(overrides)
      result.current(event, '/ops/queues')
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('does nothing when the click was already handled', () => {
    const startViewTransition = vi.fn()
    stubStartViewTransition(startViewTransition)

    const { result } = renderHook(() => useViewTransitionNav())
    const event = clickEvent({ defaultPrevented: true })
    result.current(event, '/ops/queues')

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })
})
