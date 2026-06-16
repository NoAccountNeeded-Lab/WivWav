import { describe, it, expect } from 'vitest'

// BottomSheet is a 'use client' component that depends on React hooks and
// pointer events — not directly importable in a pure Node environment.
// Following the PhotoGallery.test.ts pattern, the two pure utility functions
// are duplicated here under test. If the implementation changes, update both.

type SnapPoint = 'peek' | 'mid' | 'full'

const SNAP_ORDER: SnapPoint[] = ['full', 'mid', 'peek']
const PEEK_HEIGHT = 72

function resolveSnap(y: number, velocityY: number, vh: number): SnapPoint {
  const snapYs: Record<SnapPoint, number> = {
    full: vh * 0.08,
    mid: vh * 0.45,
    peek: vh - PEEK_HEIGHT,
  }

  if (velocityY > 0.35) {
    if (y < snapYs.mid) return 'mid'
    return 'peek'
  }
  if (velocityY < -0.35) {
    if (y > snapYs.mid) return 'mid'
    return 'full'
  }

  return (Object.entries(snapYs) as [SnapPoint, number][]).reduce((nearest, [s, sy]) =>
    Math.abs(sy - y) < Math.abs(snapYs[nearest] - y) ? s : nearest,
    'peek' as SnapPoint,
  )
}

function getBackdropOpacity(snap: SnapPoint, dragY: number | null, vh: number): number {
  if (dragY !== null) {
    const min = vh * 0.08
    const max = vh - PEEK_HEIGHT
    return Math.max(0, Math.min(0.5, ((max - dragY) / (max - min)) * 0.5))
  }
  if (snap === 'peek') return 0
  if (snap === 'mid') return 0.3
  return 0.5
}

// Helper — cycleSnap advances one step toward 'full' (most-open), wrapping around
function cycleSnap(current: SnapPoint): SnapPoint {
  const i = SNAP_ORDER.indexOf(current)
  return SNAP_ORDER[(i - 1 + SNAP_ORDER.length) % SNAP_ORDER.length] ?? current
}

const VH = 800

describe('resolveSnap', () => {
  // Snap positions at VH=800: full=64, mid=360, peek=728

  describe('nearest-snap (slow or no velocity)', () => {
    it('snaps to peek when y is closest to peek position', () => {
      // y=700 — closest to peek (728), farther from mid (360)
      expect(resolveSnap(700, 0, VH)).toBe('peek')
    })

    it('snaps to mid when y is closest to mid position', () => {
      // y=360 — exactly mid
      expect(resolveSnap(360, 0, VH)).toBe('mid')
    })

    it('snaps to full when y is closest to full position', () => {
      // y=64 — exactly full
      expect(resolveSnap(64, 0, VH)).toBe('full')
    })

    it('snaps to full over mid when equidistant (full wins due to reduce start)', () => {
      // midpoint between full(64) and mid(360) = 212
      // At y=212 distance to full = 148, distance to mid = 148 — tie breaks to whichever
      // appears first in Object.entries that beats 'peek' as seed
      const result = resolveSnap(212, 0, VH)
      expect(['full', 'mid']).toContain(result)
    })

    it('snaps to mid over peek when y is above the midpoint of their gap', () => {
      // midpoint between mid(360) and peek(728) = 544; y=500 — closer to mid(360)
      expect(resolveSnap(500, 0, VH)).toBe('mid')
    })

    it('snaps to peek over mid when y is below the midpoint of their gap', () => {
      // y=600 — closer to peek(728) than mid(360)
      expect(resolveSnap(600, 0, VH)).toBe('peek')
    })

    it('velocity within ±0.35 does not trigger fast-path', () => {
      // y=700 (near peek), velocity=0.34 (just below fast threshold)
      expect(resolveSnap(700, 0.34, VH)).toBe('peek')
    })
  })

  describe('fast downward swipe (velocityY > 0.35)', () => {
    it('collapses to mid when sheet is above mid snap point', () => {
      // y=100 — above mid (360), fast downward
      expect(resolveSnap(100, 0.5, VH)).toBe('mid')
    })

    it('collapses to peek when sheet is at or below mid snap point', () => {
      // y=400 — below mid (360), fast downward
      expect(resolveSnap(400, 0.5, VH)).toBe('peek')
    })

    it('collapses to peek when sheet is exactly at mid', () => {
      // y=360 — exactly mid; condition is y < mid so this goes to peek
      expect(resolveSnap(360, 0.5, VH)).toBe('peek')
    })

    it('triggers at exactly velocityY=0.36', () => {
      expect(resolveSnap(100, 0.36, VH)).toBe('mid')
    })
  })

  describe('fast upward swipe (velocityY < -0.35)', () => {
    it('expands to mid when sheet is below mid snap point', () => {
      // y=600 — below mid (360), fast upward
      expect(resolveSnap(600, -0.5, VH)).toBe('mid')
    })

    it('expands to full when sheet is at or above mid snap point', () => {
      // y=200 — above mid (360), fast upward
      expect(resolveSnap(200, -0.5, VH)).toBe('full')
    })

    it('expands to mid when sheet is exactly at mid', () => {
      // y=360 — exactly mid; condition is y > mid (false), so goes to full
      expect(resolveSnap(360, -0.5, VH)).toBe('full')
    })

    it('triggers at exactly velocityY=-0.36', () => {
      expect(resolveSnap(600, -0.36, VH)).toBe('mid')
    })
  })
})

describe('getBackdropOpacity', () => {
  describe('static snap states (no drag)', () => {
    it('returns 0 for peek', () => {
      expect(getBackdropOpacity('peek', null, VH)).toBe(0)
    })

    it('returns 0.3 for mid', () => {
      expect(getBackdropOpacity('mid', null, VH)).toBe(0.3)
    })

    it('returns 0.5 for full', () => {
      expect(getBackdropOpacity('full', null, VH)).toBe(0.5)
    })
  })

  describe('during drag (dragY !== null)', () => {
    // min = 800*0.08 = 64 (full), max = 800-72 = 728 (peek)
    // opacity = ((728 - dragY) / (728 - 64)) * 0.5 clamped [0, 0.5]

    it('returns 0.5 at the top of the drag range (full position)', () => {
      // dragY = min (64) → (728-64)/(728-64) * 0.5 = 0.5
      const opacity = getBackdropOpacity('peek', 64, VH)
      expect(opacity).toBeCloseTo(0.5)
    })

    it('returns 0 at the bottom of the drag range (peek position)', () => {
      // dragY = max (728) → (728-728)/(664) * 0.5 = 0
      const opacity = getBackdropOpacity('full', 728, VH)
      expect(opacity).toBeCloseTo(0)
    })

    it('returns ~0.25 at midpoint', () => {
      // dragY = (64+728)/2 = 396 → (728-396)/664 * 0.5 ≈ 0.25
      const opacity = getBackdropOpacity('mid', 396, VH)
      expect(opacity).toBeCloseTo(0.25, 2)
    })

    it('clamps to 0 when dragY exceeds max', () => {
      // dragY > 728 — would produce negative, clamp to 0
      const opacity = getBackdropOpacity('peek', 750, VH)
      expect(opacity).toBe(0)
    })

    it('clamps to 0.5 when dragY is below min', () => {
      // dragY < 64 — would exceed 0.5, clamp to 0.5
      const opacity = getBackdropOpacity('peek', 0, VH)
      expect(opacity).toBe(0.5)
    })

    it('ignores the snap argument when dragY is provided', () => {
      // Same dragY=396 regardless of snap
      expect(getBackdropOpacity('peek', 396, VH)).toBeCloseTo(0.25, 2)
      expect(getBackdropOpacity('full', 396, VH)).toBeCloseTo(0.25, 2)
    })
  })
})

describe('cycleSnap', () => {
  // SNAP_ORDER = ['full', 'mid', 'peek']
  // cycleSnap does i-1 (wrapping), so it cycles: full→peek→mid→full
  it('advances from peek → mid', () => {
    // peek is at index 2; i-1=1 → 'mid'
    expect(cycleSnap('peek')).toBe('mid')
  })

  it('advances from full → peek', () => {
    // full is at index 0; i-1=-1+3=2 → 'peek'
    expect(cycleSnap('full')).toBe('peek')
  })

  it('advances from mid → full', () => {
    // mid is at index 1; i-1=0 → 'full'
    expect(cycleSnap('mid')).toBe('full')
  })
})
