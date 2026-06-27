// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ListingsVisitSession, useLastListingsVisit } from './ListingsVisitSession'

// Consumer that renders the context value so we can assert against it
function LastVisitDisplay() {
  const lastVisit = useLastListingsVisit()
  return <div data-testid="last-visit">{lastVisit ?? 'none'}</div>
}

// Simulates pagination: renders a list of children that can be extended after mount
function PaginatedListings({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial)
  return (
    <ListingsVisitSession>
      <ul>
        {Array.from({ length: count }, (_, i) => (
          <li key={i} data-testid={`item-${i}`}>
            <LastVisitDisplay />
          </li>
        ))}
      </ul>
      <button onClick={() => setCount((c) => c + 1)}>Load more</button>
    </ListingsVisitSession>
  )
}

let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ListingsVisitSession', () => {
  it('provides the previous session timestamp to children, not the current one', async () => {
    const previousSession = '2026-01-01T12:00:00.000Z'
    store.set('wav-last-visit', previousSession)

    await act(async () => {
      render(
        <ListingsVisitSession>
          <LastVisitDisplay />
        </ListingsVisitSession>,
      )
    })

    // Children receive the previous session value
    expect(screen.getByTestId('last-visit').textContent).toBe(previousSession)

    // Storage has been updated to the current session — so page 2, 3, etc.
    // children that mount later still get previousSession from context, not this new value
    expect(store.get('wav-last-visit')).not.toBe(previousSession)
  })

  it('provides null to first-time visitors (no prior timestamp)', async () => {
    await act(async () => {
      render(
        <ListingsVisitSession>
          <LastVisitDisplay />
        </ListingsVisitSession>,
      )
    })

    expect(screen.getByTestId('last-visit').textContent).toBe('none')
  })

  it('new badges mounting after soft navigation still receive the previous-session timestamp, not the current one', async () => {
    // Arrange: set up a previous-session timestamp
    const previousSession = '2026-01-01T12:00:00.000Z'
    store.set('wav-last-visit', previousSession)

    // Act: mount the session with one item (simulating page 1 load)
    const { getByRole } = await act(async () =>
      render(<PaginatedListings initial={1} />),
    )

    // After mount, ListingsVisitSession has written T_curr to localStorage
    const currentSession = store.get('wav-last-visit')
    expect(currentSession).not.toBe(previousSession)

    // The existing item sees T_prev
    expect(screen.getAllByTestId('last-visit')[0]?.textContent).toBe(previousSession)

    // Act: simulate soft navigation by mounting a new item (e.g. going to page 2)
    await act(async () => {
      getByRole('button', { name: 'Load more' }).click()
    })

    // Assert: the newly mounted item ALSO receives T_prev from context, NOT T_curr from localStorage
    const allDisplays = screen.getAllByTestId('last-visit')
    expect(allDisplays).toHaveLength(2)
    expect(allDisplays[1]?.textContent).toBe(previousSession)
  })
})
