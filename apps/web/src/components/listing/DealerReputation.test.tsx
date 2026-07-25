// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DealerReputation } from './DealerReputation'
import type { DealerProfile, DealerReview } from '@/app/[locale]/listings/[id]/types'

afterEach(() => cleanup())

const baseProfile: DealerProfile = {
  id: 'dp1',
  name: 'Acme Vans',
  rating: 4.6,
  reviewCount: 42,
  hours: null,
}

const baseReview: DealerReview = {
  id: 'r1',
  authorName: 'J. Smith',
  rating: 5,
  text: 'Great experience buying a wheelchair van here — staff was patient and knowledgeable.',
  publishedAt: '2026-06-01T12:00:00.000Z',
  source: 'google',
}

describe('DealerReputation', () => {
  it('shows the star rating and review count for an enriched profile (#919)', () => {
    render(<DealerReputation dealerProfile={baseProfile} reviews={[]} />)

    expect(screen.getByText('4.6')).toBeTruthy()
    expect(screen.getByText('(42 reviews)')).toBeTruthy()
    expect(screen.getByRole('img', { name: '4.6 out of 5 stars' })).toBeTruthy()
  })

  it('shows at least one review with author, rating, snippet, and date', () => {
    render(<DealerReputation dealerProfile={baseProfile} reviews={[baseReview]} />)

    expect(screen.getByText('J. Smith')).toBeTruthy()
    expect(screen.getByText(/Great experience buying a wheelchair van/)).toBeTruthy()
    expect(screen.getByText('Jun 1, 2026')).toBeTruthy()
    expect(screen.getByText('via Google')).toBeTruthy()
  })

  it('truncates a long review to a snippet rather than rendering the full text', () => {
    const longReview: DealerReview = { ...baseReview, text: 'x'.repeat(400) }
    render(<DealerReputation dealerProfile={baseProfile} reviews={[longReview]} />)

    const rendered = screen.getByText(/x{50,}/).textContent ?? ''
    expect(rendered.length).toBeLessThan(400)
    expect(rendered.endsWith('…')).toBe(true)
  })

  it('labels a non-Google review source generically instead of assuming Google', () => {
    const dealerRaterReview: DealerReview = { ...baseReview, source: 'dealerrater' }
    render(<DealerReputation dealerProfile={baseProfile} reviews={[dealerRaterReview]} />)

    expect(screen.getByText('via Dealerrater')).toBeTruthy()
  })

  it('renders nothing for a matched profile with no rating, reviews, or hours', () => {
    const emptyProfile: DealerProfile = { id: 'dp2', name: 'No Data Motors', rating: null, reviewCount: null, hours: null }
    const { container } = render(<DealerReputation dealerProfile={emptyProfile} reviews={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders an open-now badge and hours list from Google Places opening_hours JSON', () => {
    const profileWithHours: DealerProfile = {
      ...baseProfile,
      rating: null,
      reviewCount: null,
      hours: { open_now: true, weekday_text: ['Monday: 9 AM – 6 PM', 'Tuesday: 9 AM – 6 PM'] },
    }
    render(<DealerReputation dealerProfile={profileWithHours} reviews={[]} />)

    expect(screen.getByText('Open now')).toBeTruthy()
    expect(screen.getByText('Monday: 9 AM – 6 PM')).toBeTruthy()
  })

  it('does not crash and shows no open/closed badge when hours JSON has an unexpected shape', () => {
    const profileWithWeirdHours: DealerProfile = {
      ...baseProfile,
      rating: null,
      reviewCount: null,
      hours: { some_future_field: 'unexpected' },
    }
    const { container } = render(<DealerReputation dealerProfile={profileWithWeirdHours} reviews={[]} />)

    expect(screen.queryByText('Open now')).toBeNull()
    expect(screen.queryByText('Closed now')).toBeNull()
    expect(container.firstChild).toBeNull()
  })
})
