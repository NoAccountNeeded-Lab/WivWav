import { describe, expect, it } from 'vitest'
import { isListingNewSinceLastVisit } from './new-badge-utils'

describe('isListingNewSinceLastVisit', () => {
  it('marks listings after the previous visit as new', () => {
    expect(
      isListingNewSinceLastVisit(
        '2026-06-21T10:15:00.000Z',
        '2026-06-21T10:00:00.000Z',
      ),
    ).toBe(true)
  })

  it('does not mark listings at or before the previous visit as new', () => {
    expect(
      isListingNewSinceLastVisit(
        '2026-06-21T10:00:00.000Z',
        '2026-06-21T10:00:00.000Z',
      ),
    ).toBe(false)

    expect(
      isListingNewSinceLastVisit(
        '2026-06-21T09:59:59.999Z',
        '2026-06-21T10:00:00.000Z',
      ),
    ).toBe(false)
  })

  it('does not mark listings new before the previous visit has loaded', () => {
    expect(isListingNewSinceLastVisit('2026-06-21T10:15:00.000Z', undefined)).toBe(false)
    expect(isListingNewSinceLastVisit('2026-06-21T10:15:00.000Z', null)).toBe(false)
  })

  it('ignores invalid dates', () => {
    expect(isListingNewSinceLastVisit('not-a-date', '2026-06-21T10:00:00.000Z')).toBe(false)
    expect(isListingNewSinceLastVisit('2026-06-21T10:15:00.000Z', 'not-a-date')).toBe(false)
  })
})
