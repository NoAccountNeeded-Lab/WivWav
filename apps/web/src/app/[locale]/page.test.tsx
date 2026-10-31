// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import { buildHomeSnapshot } from '@/lib/home-snapshot'
import { HomeContent } from './HomeContent'

afterEach(() => cleanup())

const facets = {
  total: 1234,
  calculatedAt: '2026-10-31T08:05:00.000Z',
  priceDistribution: [{ bucket: '45000-50000', count: 40 }],
  stateBreakdown: [{ value: 'MO', count: 10 }],
  conversionBreakdown: [{ value: 'side_entry', count: 50 }, { value: 'unknown', count: 20 }],
}

const render = (raw: unknown) => renderWithIntl(<HomeContent locale="en" result={buildHomeSnapshot(raw)} />)

describe('HomeContent', () => {
  it('shows snapshot, timestamp, coverage and filter-preserving Discover links', () => {
    render(facets)
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Find your vehicle' })).toHaveLength(2)
    expect(screen.getByText('1,234')).toBeTruthy()
    expect(screen.getByText(/Calculated .*2026.* UTC/).closest('time')?.getAttribute('datetime')).toBe(facets.calculatedAt)
    expect(screen.getByRole('link', { name: /\$45K–\$50K: 40 vehicles/ }).getAttribute('href')).toBe('/en/discover?priceMin=4500000&priceMax=4999999')
    expect(screen.getByRole('link', { name: /Side entry: 50/ }).getAttribute('href')).toBe('/en/discover?conversionType=side_entry')
    expect(screen.getByText('1,224 with no known state')).toBeTruthy()
    expect(screen.getByText('1,184 with no known entry type')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See vehicles with a lift' }).getAttribute('href')).toBe('/en/discover?wavFeatures=has_lift')
  })

  it.each([
    ['outage fallback', { total: 0, stateBreakdown: [] }],
    ['stale cached payload', { total: 9, stateBreakdown: [{ value: 'MO', count: 9 }] }],
    ['no payload', undefined],
  ])('shows an honest unavailable state for %s, never zeros', (_name, raw) => {
    render(raw)
    expect(screen.getByRole('status').textContent).toMatch(/unavailable/i)
    expect(screen.queryByText(/\b0 vehicles|Vehicles available/i)).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Find your vehicle' })).toHaveLength(2)
  })

  it('hides the missing-data card when counts exceed the total', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render({ ...facets, total: 5 })
    expect(screen.queryByRole('heading', { name: 'Missing data' })).toBeNull()
  })

  it('labels unknown entry values without colliding with other message keys', () => {
    render({ ...facets, conversionBreakdown: [{ value: 'heading', count: 3 }] })
    expect(screen.getByRole('link', { name: /heading: 3/ })).toBeTruthy()
  })

  it('does not imply missing safety data means no recalls', () => {
    render(facets)
    expect(screen.getByText(/does not mean a vehicle has no recalls/)).toBeTruthy()
  })
})
