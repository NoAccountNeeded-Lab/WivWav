import { describe, it, expect } from 'vitest'

// Tabs is a 'use client' component that depends on React hooks and DOM refs —
// not directly importable in a pure Node environment. Following the project
// pattern (PhotoGallery.test.ts), the pure keyboard-navigation logic is
// duplicated here under test. If the implementation changes, update both.

type TabId = string

interface TabDef {
  id: TabId
}

/**
 * Returns the next active index given a keyboard event key.
 * Mirrors the handleKeyDown logic in Tabs.tsx.
 */
function resolveNextIndex(key: string, currentIndex: number, tabCount: number): number | null {
  if (key === 'ArrowRight') return (currentIndex + 1) % tabCount
  if (key === 'ArrowLeft') return (currentIndex - 1 + tabCount) % tabCount
  if (key === 'Home') return 0
  if (key === 'End') return tabCount - 1
  return null
}

/**
 * Given a list of tabs and a current active id, returns the new active id
 * after a keyboard event (or the original id when the key is unhandled).
 */
function handleTabKeyDown(key: string, tabs: TabDef[], activeId: TabId): TabId {
  const currentIndex = tabs.findIndex(t => t.id === activeId)
  if (currentIndex === -1) return activeId
  const next = resolveNextIndex(key, currentIndex, tabs.length)
  if (next === null) return activeId
  return tabs[next]?.id ?? activeId
}

const TABS: TabDef[] = [
  { id: 'wav' },
  { id: 'vehicle' },
  { id: 'overview' },
  { id: 'market' },
  { id: 'safety' },
]

describe('Tabs keyboard navigation', () => {
  describe('ArrowRight', () => {
    it('moves to the next tab', () => {
      expect(handleTabKeyDown('ArrowRight', TABS, 'wav')).toBe('vehicle')
    })

    it('wraps from last tab back to first', () => {
      expect(handleTabKeyDown('ArrowRight', TABS, 'safety')).toBe('wav')
    })

    it('works from a mid-list tab', () => {
      expect(handleTabKeyDown('ArrowRight', TABS, 'overview')).toBe('market')
    })
  })

  describe('ArrowLeft', () => {
    it('moves to the previous tab', () => {
      expect(handleTabKeyDown('ArrowLeft', TABS, 'vehicle')).toBe('wav')
    })

    it('wraps from first tab back to last', () => {
      expect(handleTabKeyDown('ArrowLeft', TABS, 'wav')).toBe('safety')
    })

    it('works from a mid-list tab', () => {
      expect(handleTabKeyDown('ArrowLeft', TABS, 'market')).toBe('overview')
    })
  })

  describe('Home', () => {
    it('jumps to the first tab from any position', () => {
      expect(handleTabKeyDown('Home', TABS, 'safety')).toBe('wav')
      expect(handleTabKeyDown('Home', TABS, 'overview')).toBe('wav')
    })

    it('stays on first tab when already there', () => {
      expect(handleTabKeyDown('Home', TABS, 'wav')).toBe('wav')
    })
  })

  describe('End', () => {
    it('jumps to the last tab from any position', () => {
      expect(handleTabKeyDown('End', TABS, 'wav')).toBe('safety')
      expect(handleTabKeyDown('End', TABS, 'overview')).toBe('safety')
    })

    it('stays on last tab when already there', () => {
      expect(handleTabKeyDown('End', TABS, 'safety')).toBe('safety')
    })
  })

  describe('unhandled keys', () => {
    it('returns the current tab id unchanged for Enter', () => {
      expect(handleTabKeyDown('Enter', TABS, 'overview')).toBe('overview')
    })

    it('returns the current tab id unchanged for Tab', () => {
      expect(handleTabKeyDown('Tab', TABS, 'wav')).toBe('wav')
    })

    it('returns the current tab id unchanged for Escape', () => {
      expect(handleTabKeyDown('Escape', TABS, 'market')).toBe('market')
    })

    it('returns the current tab id unchanged for an arbitrary key', () => {
      expect(handleTabKeyDown('a', TABS, 'vehicle')).toBe('vehicle')
    })
  })

  describe('single-tab edge case', () => {
    const SINGLE = [{ id: 'only' }]

    it('ArrowRight wraps back to itself', () => {
      expect(handleTabKeyDown('ArrowRight', SINGLE, 'only')).toBe('only')
    })

    it('ArrowLeft wraps back to itself', () => {
      expect(handleTabKeyDown('ArrowLeft', SINGLE, 'only')).toBe('only')
    })

    it('Home returns the only tab', () => {
      expect(handleTabKeyDown('Home', SINGLE, 'only')).toBe('only')
    })

    it('End returns the only tab', () => {
      expect(handleTabKeyDown('End', SINGLE, 'only')).toBe('only')
    })
  })
})

describe('resolveNextIndex', () => {
  const COUNT = 5

  describe('boundary conditions', () => {
    it('ArrowRight at last index wraps to 0', () => {
      expect(resolveNextIndex('ArrowRight', 4, COUNT)).toBe(0)
    })

    it('ArrowLeft at index 0 wraps to last', () => {
      expect(resolveNextIndex('ArrowLeft', 0, COUNT)).toBe(4)
    })

    it('Home always returns 0', () => {
      expect(resolveNextIndex('Home', 3, COUNT)).toBe(0)
    })

    it('End always returns tabCount - 1', () => {
      expect(resolveNextIndex('End', 0, COUNT)).toBe(4)
    })
  })

  describe('unhandled key returns null', () => {
    it('returns null for Space', () => {
      expect(resolveNextIndex(' ', 0, COUNT)).toBeNull()
    })

    it('returns null for ArrowUp', () => {
      expect(resolveNextIndex('ArrowUp', 0, COUNT)).toBeNull()
    })

    it('returns null for ArrowDown', () => {
      expect(resolveNextIndex('ArrowDown', 0, COUNT)).toBeNull()
    })
  })
})
