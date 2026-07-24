// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceState } from './useWorkspaceState'

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

function setUrl(pathname: string, search: string) {
  mockUsePathname.mockReturnValue(pathname)
  mockUseSearchParams.mockReturnValue(new URLSearchParams(search))
}

describe('useWorkspaceState', () => {
  it('starts empty when no panels are in the URL', () => {
    setUrl('/ops/runs', '')
    const { result } = renderHook(() => useWorkspaceState())

    expect(result.current.panels).toEqual([])
    expect(result.current.maximizedId).toBeNull()
  })

  it('reproduces the panel set from a URL that already contains it (reload-safe)', () => {
    setUrl('/ops/runs', 'panels=run:1234:2&max=run:1234')
    const { result } = renderHook(() => useWorkspaceState())

    expect(result.current.panels).toEqual([{ id: 'run:1234', entityType: 'run', entityId: '1234', span: 2 }])
    expect(result.current.maximizedId).toBe('run:1234')
  })

  it('openPanel pushes a new panel onto the URL and sets it as the focus target', () => {
    setUrl('/ops/runs', '')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.openPanel('run', '1234')
    })

    expect(mockPush).toHaveBeenCalledWith('/ops/runs?panels=run%3A1234%3A1', { scroll: false })
    expect(result.current.focusTarget).toBe('run:1234')
  })

  it('opening an already-open panel focuses it instead of duplicating it', () => {
    setUrl('/ops/runs', 'panels=run:1234:1')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.openPanel('run', '1234')
    })

    expect(mockPush).not.toHaveBeenCalled()
    expect(result.current.focusTarget).toBe('run:1234')
  })

  it('closePanel removes the panel and clears maximizedId if it was maximized, without a new history entry', () => {
    setUrl('/ops/runs', 'panels=run:1234:1,source:blvd:1&max=run:1234')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.closePanel('run:1234')
    })

    expect(mockReplace).toHaveBeenCalledWith('/ops/runs?panels=source%3Ablvd%3A1', { scroll: false })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('maximize sets maximizedId and the focus target; only for a panel that is open', () => {
    setUrl('/ops/runs', 'panels=run:1234:1')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.maximize('source:blvd')
    })
    expect(mockPush).not.toHaveBeenCalled()

    act(() => {
      result.current.maximize('run:1234')
    })
    expect(mockPush).toHaveBeenCalledWith('/ops/runs?panels=run%3A1234%3A1&max=run%3A1234', { scroll: false })
    expect(result.current.focusTarget).toBe('run:1234')
  })

  it('restore clears maximizedId, sets the focus target back to the previously maximized panel, and does not add a history entry', () => {
    setUrl('/ops/runs', 'panels=run:1234:1&max=run:1234')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.restore()
    })

    expect(mockReplace).toHaveBeenCalledWith('/ops/runs?panels=run%3A1234%3A1', { scroll: false })
    expect(result.current.focusTarget).toBe('run:1234')
  })

  it('setSpan updates a single panel without adding a history entry', () => {
    setUrl('/ops/runs', 'panels=run:1234:1')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.setSpan('run:1234', 2)
    })

    expect(mockReplace).toHaveBeenCalledWith('/ops/runs?panels=run%3A1234%3A2', { scroll: false })
  })

  it('consumeFocusTarget clears the pending focus target', () => {
    setUrl('/ops/runs', '')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.openPanel('run', '1234')
    })
    expect(result.current.focusTarget).toBe('run:1234')

    act(() => {
      result.current.consumeFocusTarget()
    })
    expect(result.current.focusTarget).toBeNull()
  })

  it('minimize sets minimizedId without a new history entry; only for a panel that is open', () => {
    setUrl('/ops/runs', 'panels=run:1234:1')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.minimize('source:blvd')
    })
    expect(mockReplace).not.toHaveBeenCalled()

    act(() => {
      result.current.minimize('run:1234')
    })
    expect(mockReplace).toHaveBeenCalledWith('/ops/runs?panels=run%3A1234%3A1&min=run%3A1234', { scroll: false })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('minimize clears maximizedId when minimizing the currently maximized panel', () => {
    setUrl('/ops/runs', 'panels=run:1234:1&max=run:1234')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.minimize('run:1234')
    })
    expect(mockReplace).toHaveBeenCalledWith('/ops/runs?panels=run%3A1234%3A1&min=run%3A1234', { scroll: false })
  })

  it('restoreMinimized clears minimizedId, sets the focus target, and does not add a history entry', () => {
    setUrl('/ops/runs', 'panels=run:1234:1&min=run:1234')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.restoreMinimized('run:1234')
    })

    expect(mockReplace).toHaveBeenCalledWith('/ops/runs?panels=run%3A1234%3A1', { scroll: false })
    expect(mockPush).not.toHaveBeenCalled()
    expect(result.current.focusTarget).toBe('run:1234')
  })

  it('maximize clears minimizedId when maximizing the currently minimized panel', () => {
    setUrl('/ops/runs', 'panels=run:1234:1&min=run:1234')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.maximize('run:1234')
    })
    expect(mockPush).toHaveBeenCalledWith('/ops/runs?panels=run%3A1234%3A1&max=run%3A1234', { scroll: false })
  })

  it('replacePanels fully swaps the panel set (not a merge) and clears maximized/minimized state', () => {
    setUrl('/ops/runs', 'panels=run:1234:1,source:blvd:1&max=run:1234&min=source:blvd')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.replacePanels([
        { entityType: 'problems', entityId: 'main', span: 2 },
        { entityType: 'queues', entityId: 'main', span: 2 },
      ])
    })

    expect(mockPush).toHaveBeenCalledWith('/ops/runs?panels=problems%3Amain%3A2%2Cqueues%3Amain%3A2', { scroll: false })
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('replacePanels deduplicates entries that share an entityType/entityId pair, keeping the first', () => {
    setUrl('/ops/runs', '')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.replacePanels([
        { entityType: 'problems', entityId: 'main', span: 2 },
        { entityType: 'problems', entityId: 'main', span: 1 },
      ])
    })

    expect(mockPush).toHaveBeenCalledWith('/ops/runs?panels=problems%3Amain%3A2', { scroll: false })
  })

  it('replacePanels defaults a panel with no explicit span to the default span', () => {
    setUrl('/ops/runs', '')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.replacePanels([{ entityType: 'readiness', entityId: 'main' }])
    })

    expect(mockPush).toHaveBeenCalledWith('/ops/runs?panels=readiness%3Amain%3A1', { scroll: false })
  })

  it('openPanel un-minimizes an already-open, minimized panel and focuses it', () => {
    setUrl('/ops/runs', 'panels=run:1234:1&min=run:1234')
    const { result } = renderHook(() => useWorkspaceState())

    act(() => {
      result.current.openPanel('run', '1234')
    })

    expect(mockReplace).toHaveBeenCalledWith('/ops/runs?panels=run%3A1234%3A1', { scroll: false })
    expect(result.current.focusTarget).toBe('run:1234')
  })
})
