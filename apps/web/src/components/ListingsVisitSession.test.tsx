// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListingsVisitSession, useLastListingsVisit } from './ListingsVisitSession'

// Consumer that renders the context value so we can assert against it
function LastVisitDisplay() {
  const lastVisit = useLastListingsVisit()
  return <div data-testid="last-visit">{lastVisit ?? 'none'}</div>
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
})
