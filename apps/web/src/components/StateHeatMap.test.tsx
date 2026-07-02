// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  cleanup()
  vi.unstubAllGlobals()
})

describe('StateHeatMap', () => {
  it('renders a selectable region per state with its listing count in the accessible label', async () => {
    await act(async () => {
      render(
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
      render(
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
      render(
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
      render(
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
      render(
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

    fireEvent.mouseLeave(screen.getByRole('button', { name: 'California: 12 listings' }))
    expect(screen.getByText('Hover or select a state to see listing counts')).toBeDefined()
  })

  it('treats a state with no matching listings as zero, not missing', async () => {
    await act(async () => {
      render(
        <StateHeatMap
          data={[{ value: 'CA', count: 12 }]}
          activeStates={[]}
          onToggle={vi.fn()}
        />,
      )
    })

    expect(screen.getByRole('button', { name: 'Texas: 0 listings' })).toBeDefined()
  })
})
