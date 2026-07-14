import { describe, expect, it } from 'vitest'
import { parseSourceListingDates } from './source-listing-dates.js'

describe('parseSourceListingDates', () => {
  it('normalizes source-provided listing and update dates', () => {
    expect(parseSourceListingDates({
      listedAt: '2026-05-01T12:30:00-04:00',
      updatedAt: '2026-05-03T09:15:00Z',
    })).toEqual({
      sourceListedAt: new Date('2026-05-01T16:30:00.000Z'),
      sourceUpdatedAt: new Date('2026-05-03T09:15:00.000Z'),
    })
  })

  it('returns null for missing or invalid source dates', () => {
    expect(parseSourceListingDates({ listedAt: '', updatedAt: 'not-a-date' })).toEqual({
      sourceListedAt: null,
      sourceUpdatedAt: null,
    })
  })
})
