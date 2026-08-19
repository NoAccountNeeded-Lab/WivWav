// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListingsVisitSession } from './ListingsVisitSession'
import { NewBadge, isListingNewSinceLastVisit } from './NewBadge'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  })
})

function renderBadge(listedAt: string, previousVisit?: string) {
  if (previousVisit) window.localStorage.setItem('wav-last-visit', previousVisit)
  render(
    <ListingsVisitSession>
      <NewBadge listedAt={listedAt} />
    </ListingsVisitSession>,
  )
}

describe('NewBadge', () => {
  it('renders for a listing newer than the previous ListingsVisitSession visit', () => {
    renderBadge('2026-06-21T10:15:00.000Z', '2026-06-21T10:00:00.000Z')

    expect(screen.getByText('New')).toBeDefined()
  })

  it('remains absent for a first visit', () => {
    renderBadge('2026-06-21T10:15:00.000Z')

    expect(screen.queryByText('New')).toBeNull()
  })

  it('remains absent when the listing is older than the previous visit', () => {
    renderBadge('2026-06-21T09:59:59.999Z', '2026-06-21T10:00:00.000Z')

    expect(screen.queryByText('New')).toBeNull()
  })

  it('remains absent for invalid timestamps', () => {
    renderBadge('not-a-date', '2026-06-21T10:00:00.000Z')

    expect(screen.queryByText('New')).toBeNull()
  })
})

describe('isListingNewSinceLastVisit', () => {
  it('does not mark listings new before the previous visit has loaded', () => {
    expect(isListingNewSinceLastVisit('2026-06-21T10:15:00.000Z', undefined)).toBe(false)
  })

  it('does not mark listings new with an invalid previous timestamp', () => {
    expect(isListingNewSinceLastVisit('2026-06-21T10:15:00.000Z', 'not-a-date')).toBe(false)
  })
})
