// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StateHeatMap from './StateHeatMap'

// Minimal 2-state topojson fixture (California, Texas) — enough for
// topojson-client's feature() to produce renderable Polygon geometries
// without depending on the full 115KB us-atlas dataset in unit tests.
const FIXTURE_TOPOLOGY = {
  type: 'Topology',
  objects: {
    states: {
      type: 'GeometryCollection',
      geometries: [
        {
          type: 'Polygon',
          arcs: [[0]],
          id: '06',
          properties: { name: 'California' },
        },
        {
          type: 'Polygon',
          arcs: [[1]],
          id: '48',
          properties: { name: 'Texas' },
        },
      ],
    },
  },
  arcs: [
    [[-124, 32], [-114, 32], [-114, 42], [-124, 42], [-124, 32]],
    [[-106, 25], [-93, 25], [-93, 36], [-106, 36], [-106, 25]],
  ],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve(FIXTURE_TOPOLOGY),
    }),
  ))
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
  vi.unstubAllGlobals()
})

const realMatches = Element.prototype.matches
/** jsdom has no focus-visible heuristics, so tests choose the answer. */
function forceFocusVisible(value: boolean) {
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? value : realMatches.call(this, selector)
  })
}

describe('StateHeatMap', () => {
  it('renders a selectable region per state with its listing count in the accessible label', async () => {
    await act(async () => {
      renderWithIntl(
        <StateHeatMap
          data={[{ value: 'CA', count: 12 }, { value: 'TX', count: 4 }]}
          activeStates={[]}
          onToggle={vi.fn()}
        />,
      )
    })

    expect(screen.getByRole('button', { name: 'California: 12 listings' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Texas: 4 listings' })).toBeDefined()
  })

  it('marks currently active filter states as pressed', async () => {
    await act(async () => {
      renderWithIntl(
        <StateHeatMap
          data={[{ value: 'CA', count: 12 }, { value: 'TX', count: 4 }]}
          activeStates={['CA']}
          onToggle={vi.fn()}
        />,
      )
    })

    expect(
      screen.getByRole('button', { name: 'California: 12 listings, selected' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Texas: 4 listings' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('invokes onToggle with the state abbreviation on click', async () => {
    const onToggle = vi.fn()
    await act(async () => {
      renderWithIntl(
        <StateHeatMap
          data={[{ value: 'CA', count: 12 }, { value: 'TX', count: 4 }]}
          activeStates={[]}
          onToggle={onToggle}
        />,
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'California: 12 listings' }))
    expect(onToggle).toHaveBeenCalledWith('CA')
  })

  it('invokes onToggle on Enter and Space keydown for keyboard users', async () => {
    const onToggle = vi.fn()
    await act(async () => {
      renderWithIntl(
        <StateHeatMap
          data={[{ value: 'CA', count: 12 }, { value: 'TX', count: 4 }]}
          activeStates={[]}
          onToggle={onToggle}
        />,
      )
    })

    const texas = screen.getByRole('button', { name: 'Texas: 4 listings' })
    fireEvent.keyDown(texas, { key: 'Enter' })
    fireEvent.keyDown(texas, { key: ' ' })
    expect(onToggle).toHaveBeenCalledTimes(2)
    expect(onToggle).toHaveBeenNthCalledWith(1, 'TX')
    expect(onToggle).toHaveBeenNthCalledWith(2, 'TX')
  })

  it('shows the hovered state and count in the live status region', async () => {
    await act(async () => {
      renderWithIntl(
        <StateHeatMap
          data={[{ value: 'CA', count: 12 }, { value: 'TX', count: 4 }]}
          activeStates={[]}
          onToggle={vi.fn()}
        />,
      )
    })

    expect(screen.getByText('Hover or select a state to see listing counts')).toBeDefined()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'California: 12 listings' }))
    expect(screen.getByText('California: 12 listings', { selector: 'div' })).toBeDefined()

    fireEvent.pointerLeave(screen.getByRole('button', { name: 'California: 12 listings' }))
    expect(screen.getByText('Hover or select a state to see listing counts')).toBeDefined()
  })

  it('treats a state with no matching listings as zero, not missing', async () => {
    await act(async () => {
      renderWithIntl(
        <StateHeatMap data={[{ value: 'CA', count: 12 }]} activeStates={[]} onToggle={vi.fn()} />,
      )
    })

    expect(screen.getByRole('button', { name: 'Texas: 0 listings' })).toBeDefined()
  })

  it('marks each positive maximum-count state for contrasting focus styling', async () => {
    await act(async () => {
      renderWithIntl(
        <StateHeatMap
          data={[
            { value: 'CA', count: 12 },
            { value: 'TX', count: 12 },
          ]}
          activeStates={[]}
          onToggle={vi.fn()}
        />,
      )
    })

    expect(
      screen.getAllByRole('button').map((state) => state.getAttribute('data-max-count')),
    ).toEqual(['true', 'true'])
  })

  it('does not mark zero-count states as maximum-count states', async () => {
    await act(async () => {
      renderWithIntl(<StateHeatMap data={[]} activeStates={[]} onToggle={vi.fn()} />)
    })

    expect(
      screen.getAllByRole('button').map((state) => state.getAttribute('data-max-count')),
    ).toEqual(['false', 'false'])
  })

  describe('styled tooltip', () => {
    const renderMap = async () => {
      let container!: HTMLElement
      await act(async () => {
        container = renderWithIntl(
          <StateHeatMap data={[{ value: 'CA', count: 12 }]} activeStates={[]} onToggle={vi.fn()} />,
        ).container
      })
      return container
    }

    it('has no native <title> tooltips', async () => {
      const container = await renderMap()
      expect(container.querySelectorAll('title')).toHaveLength(0)
    })

    it('shows on keyboard focus at once, links the region, and dismisses with Escape', async () => {
      await renderMap()
      forceFocusVisible(true)
      const california = screen.getByRole('button', { name: 'California: 12 listings' })
      fireEvent.focus(california)
      expect(document.querySelector('[data-tooltip]')!.textContent).toBe('California: 12 listings')
      // One announcement only: the control's aria-label. The tip is hidden and the live region ignores focus.
      expect(document.querySelector('[data-tooltip]')!.getAttribute('aria-hidden')).toBe('true')
      expect(california.hasAttribute('aria-describedby')).toBe(false)
      expect(screen.getByText('Hover or select a state to see listing counts')).toBeDefined()
      fireEvent.keyDown(california, { key: 'Escape' })
      expect(document.querySelector('[data-tooltip]')).toBeNull()
    })

    it('ignores focus that is not keyboard-driven', async () => {
      await renderMap()
      forceFocusVisible(false)
      fireEvent.focus(screen.getByRole('button', { name: 'California: 12 listings' }))
      expect(document.querySelector('[data-tooltip]')).toBeNull()
    })

    it('closes on touchend so a hover tip and a focus tip never stay open together', async () => {
      await renderMap()
      vi.useFakeTimers()
      try {
        const california = screen.getByRole('button', { name: 'California: 12 listings' })
        fireEvent.mouseEnter(california)
        act(() => { vi.advanceTimersByTime(160) })
        expect(document.querySelector('[data-tooltip]')).not.toBeNull()
        fireEvent.touchEnd(california)
        expect(document.querySelectorAll('[data-tooltip]')).toHaveLength(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('waits about 150 ms on hover', async () => {
      await renderMap()
      vi.useFakeTimers()
      try {
        const california = screen.getByRole('button', { name: 'California: 12 listings' })
        fireEvent.mouseEnter(california)
        act(() => { vi.advanceTimersByTime(100) })
        expect(document.querySelector('[data-tooltip]')).toBeNull()
        act(() => { vi.advanceTimersByTime(60) })
        expect(document.querySelector('[data-tooltip]')!).toBeDefined()
        fireEvent.pointerLeave(california)
        expect(document.querySelector('[data-tooltip]')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
