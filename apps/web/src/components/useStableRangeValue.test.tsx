// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Slider } from './ui/slider'
import { parsePositiveIntegerParameter, rangeFilterSearchParams, useStableRangeValue } from './useStableRangeValue'

describe('useStableRangeValue', () => {
  it('keeps the latest rapid edit visible while earlier URL navigations arrive', () => {
    const { result, rerender } = renderHook(({ committed }) => useStableRangeValue(committed), {
      initialProps: { committed: [0, 100] as [number, number] },
    })

    act(() => {
      result.current.handleChange([10, 90])
      result.current.handleCommit([10, 90])
      result.current.handleChange([20, 80])
      result.current.handleCommit([20, 80])
    })
    expect(result.current.value).toEqual([20, 80])

    rerender({ committed: [10, 90] })
    expect(result.current.value).toEqual([20, 80])

    rerender({ committed: [20, 80] })
    expect(result.current.value).toEqual([20, 80])
  })

  it('accepts browser Back and Forward URL state after a pending commit', () => {
    const { result, rerender } = renderHook(({ committed }) => useStableRangeValue(committed), {
      initialProps: { committed: [0, 100] as [number, number] },
    })
    act(() => result.current.handleCommit([25, 75]))
    expect(result.current.value).toEqual([25, 75])

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    rerender({ committed: [10, 90] })
    expect(result.current.value).toEqual([10, 90])
  })

  it('keeps a history selection stable if a delayed push resolves after Back', () => {
    const reapplyCommit = vi.fn()
    const readHistoryValue = (search: string) => {
      const params = new URLSearchParams(search)
      const min = Number(params.get('min'))
      const max = Number(params.get('max'))
      return Number.isFinite(min) && Number.isFinite(max)
        ? { range: [min, max] as const, searchParams: params.toString() }
        : null
    }
    const { result, rerender } = renderHook(
      ({ committed }) => useStableRangeValue(committed, [0, 100], reapplyCommit, readHistoryValue),
      { initialProps: { committed: [0, 100] as [number, number] } },
    )
    act(() => result.current.handleCommit([25, 75]))

    window.history.pushState({}, '', '/?min=10&max=90&page=2')
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    rerender({ committed: [10, 90] })
    expect(result.current.value).toEqual([10, 90])

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true })))
    rerender({ committed: [25, 75] })
    expect(result.current.value).toEqual([10, 90])
    expect(reapplyCommit).toHaveBeenCalledWith([10, 90], 'min=10&max=90&page=2')
    window.history.replaceState({}, '', '/')
  })

  it('keeps one-handle mileage values stable until the URL acknowledges them', () => {
    const { result, rerender } = renderHook(({ committed }) => useStableRangeValue(committed), {
      initialProps: { committed: [0, 200_000] as [number, number] },
    })
    act(() => {
      result.current.handleChange([120_000])
      result.current.handleCommit([120_000])
    })
    rerender({ committed: [0, 150_000] })
    expect(result.current.value).toEqual([0, 120_000])
    rerender({ committed: [0, 120_000] })
    expect(result.current.value).toEqual([0, 120_000])
  })

  it('reapplies the newest range when a stale navigation replaces it', () => {
    const reapplyCommit = vi.fn()
    const { result, rerender } = renderHook(
      ({ committed }) => useStableRangeValue(committed, [0, 100], reapplyCommit),
      { initialProps: { committed: [0, 100] as [number, number] } },
    )
    act(() => result.current.handleCommit([20, 80]))

    rerender({ committed: [10, 90] })
    expect(result.current.value).toEqual([20, 80])
    expect(reapplyCommit).toHaveBeenCalledTimes(1)
    expect(reapplyCommit).toHaveBeenCalledWith([20, 80], undefined)

    rerender({ committed: [10, 90] })
    expect(reapplyCommit).toHaveBeenCalledTimes(1)
    rerender({ committed: [20, 80] })
    expect(result.current.value).toEqual([20, 80])
    expect(reapplyCommit).toHaveBeenCalledTimes(1)
  })

  it('lets a newer chart selection replace a pending slider commit', () => {
    const reapplyCommit = vi.fn()
    const { result, rerender } = renderHook(
      ({ committed }) => useStableRangeValue(committed, [0, 100], reapplyCommit),
      { initialProps: { committed: [0, 100] as [number, number] } },
    )
    act(() => {
      result.current.handleCommit([20, 80])
      result.current.handleCommit([30, 30])
    })

    rerender({ committed: [10, 90] })
    expect(result.current.value).toEqual([30, 30])
    expect(reapplyCommit).toHaveBeenCalledWith([30, 30], undefined)
    rerender({ committed: [30, 30] })
    expect(result.current.value).toEqual([30, 30])
  })

  it('holds a mileage zero selection until the URL acknowledges the cleared range', () => {
    const { result, rerender } = renderHook(({ committed }) => useStableRangeValue(committed), {
      initialProps: { committed: [0, 120_000] as [number, number] },
    })
    act(() => result.current.handleCommit([0], [0, 200_000]))
    expect(result.current.value).toEqual([0, 0])

    rerender({ committed: [0, 200_000] })
    expect(result.current.value).toEqual([0, 200_000])
  })

  it('acknowledges endpoint commits by URL semantics when facet bounds change', () => {
    const reapplyCommit = vi.fn()
    const { result, rerender } = renderHook(
      ({ committed, bounds }) => useStableRangeValue(committed, bounds, reapplyCommit),
      {
        initialProps: {
          committed: [0, 120_000] as [number, number],
          bounds: [0, 200_000] as [number, number],
        },
      },
    )

    act(() => result.current.handleCommit([0, 200_000], [0, 0]))
    rerender({ committed: [0, 120_000], bounds: [0, 250_000] })
    expect(result.current.value).toEqual([0, 200_000])
    expect(reapplyCommit).not.toHaveBeenCalled()

    rerender({ committed: [0, 0], bounds: [0, 250_000] })
    expect(result.current.value).toEqual([0, 250_000])
  })

  it('keeps the selected value stable while facet data changes slider bounds', () => {
    const { result, rerender } = renderHook(({ committed }) => useStableRangeValue(committed), {
      initialProps: { committed: [0, 200_000] as [number, number] },
    })
    act(() => result.current.handleCommit([0, 120_000]))

    rerender({ committed: [0, 150_000] })
    expect(result.current.value).toEqual([0, 120_000])
  })

  it.each([
    [null, 0],
    ['', 0],
    ['0', 0],
    ['-5', 0],
    ['1.5', 0],
    ['123oops', 0],
    ['9007199254740992', 0],
    ['42', 42],
  ] as const)('parses URL range parameter %s as %i', (raw, expected) => {
    expect(parsePositiveIntegerParameter(raw)).toBe(expected)
  })

  it('preserves page on history replays but clears it for new range selections', () => {
    expect(rangeFilterSearchParams('q=van&page=2', true).get('page')).toBe('2')
    expect(rangeFilterSearchParams('q=van&page=2').get('page')).toBeNull()
  })

  it('ignores incomplete values and accepts endpoint values', () => {
    const { result } = renderHook(() => useStableRangeValue([0, 100] as [number, number]))
    act(() => {
      result.current.handleChange([])
      result.current.handleCommit([])
    })
    expect(result.current.value).toEqual([0, 100])
    act(() => result.current.handleCommit([0, 100]))
    expect(result.current.value).toEqual([0, 100])
  })

  it('preserves keyboard slider changes through the shared range handler', () => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    function KeyboardSlider() {
      const stableRange = useStableRangeValue([0, 0])
      return (
        <Slider
          min={0}
          max={10}
          value={[stableRange.value[1]]}
          onValueChange={stableRange.handleChange}
          onValueCommit={stableRange.handleCommit}
          aria-label="Maximum price"
        />
      )
    }

    render(<KeyboardSlider />)
    const slider = screen.getByRole('slider', { name: 'Maximum price' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider.getAttribute('aria-valuenow')).toBe('1')
    vi.unstubAllGlobals()
  })

  it('preserves touch pointer changes through the shared range handler', () => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    function TouchSlider() {
      const stableRange = useStableRangeValue([0, 0])
      return (
        <Slider
          min={0}
          max={100}
          value={[stableRange.value[1]]}
          onValueChange={stableRange.handleChange}
          onValueCommit={stableRange.handleCommit}
          aria-label="Maximum mileage"
        />
      )
    }

    const view = render(<TouchSlider />)
    const root = view.container.firstElementChild as HTMLElement
    Object.defineProperty(root, 'getBoundingClientRect', {
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}) }),
    })
    root.setPointerCapture = vi.fn()
    root.hasPointerCapture = vi.fn(() => true)
    root.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(root, { button: 0, pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 10 })
    fireEvent.pointerMove(root, { pointerId: 1, pointerType: 'touch', clientX: 75, clientY: 10 })
    fireEvent.pointerUp(root, { pointerId: 1, pointerType: 'touch', clientX: 75, clientY: 10 })
    expect(screen.getByRole('slider', { name: 'Maximum mileage' }).getAttribute('aria-valuenow')).toBe('75')
    vi.unstubAllGlobals()
  })
})
