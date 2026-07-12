// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInspectorParam } from './useInspectorParam'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockUsePathname = vi.fn()
const mockUseSearchParams = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('useInspectorParam', () => {
  it('is closed when the param is absent from the URL', () => {
    mockUsePathname.mockReturnValue('/ops/queues')
    mockUseSearchParams.mockReturnValue(new URLSearchParams(''))

    const { result } = renderHook(() => useInspectorParam('job'))

    expect(result.current.isOpen).toBe(false)
    expect(result.current.value).toBeNull()
  })

  it('reproduces the open state from a URL that already contains the param (reload-safe)', () => {
    mockUsePathname.mockReturnValue('/ops/queues')
    mockUseSearchParams.mockReturnValue(new URLSearchParams('job=abc-123'))

    const { result } = renderHook(() => useInspectorParam('job'))

    expect(result.current.isOpen).toBe(true)
    expect(result.current.value).toBe('abc-123')
  })

  it('open() pushes the param onto the current path, preserving other params', () => {
    mockUsePathname.mockReturnValue('/ops/queues')
    mockUseSearchParams.mockReturnValue(new URLSearchParams('status=failed'))

    const { result } = renderHook(() => useInspectorParam('job'))
    result.current.open('abc-123')

    expect(mockPush).toHaveBeenCalledWith('/ops/queues?status=failed&job=abc-123', { scroll: false })
  })

  it('close() replaces the URL without the param and without adding a history entry', () => {
    mockUsePathname.mockReturnValue('/ops/queues')
    mockUseSearchParams.mockReturnValue(new URLSearchParams('job=abc-123&status=failed'))

    const { result } = renderHook(() => useInspectorParam('job'))
    result.current.close()

    expect(mockReplace).toHaveBeenCalledWith('/ops/queues?status=failed', { scroll: false })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('close() drops a trailing "?" when the param was the only query value', () => {
    mockUsePathname.mockReturnValue('/ops/queues')
    mockUseSearchParams.mockReturnValue(new URLSearchParams('job=abc-123'))

    const { result } = renderHook(() => useInspectorParam('job'))
    result.current.close()

    expect(mockReplace).toHaveBeenCalledWith('/ops/queues', { scroll: false })
  })
})
