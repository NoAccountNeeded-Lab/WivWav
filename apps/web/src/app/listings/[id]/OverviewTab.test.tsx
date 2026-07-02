// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverviewTab } from './OverviewTab'
import type { ListingDetail } from './types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

afterEach(() => cleanup())

function makeListing(overrides: Partial<ListingDetail> = {}): ListingDetail {
  return {
    id: 'listing-1',
    sourceUrl: 'https://dealer.example.com/listing/1',
    buyerUrl: null,
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    trim: null,
    vin: '1FMJK1HT0MEA12345',
    condition: 'used',
    sellerType: 'dealer',
    priceCents: 3500000,
    mileage: 20000,
    color: null,
    fuelType: null,
    engine: null,
    transmission: null,
    stockNumber: null,
    wav: {
      conversionType: 'rear_entry',
      conversionManufacturer: null,
      floorLoweringInches: null,
      rampType: 'in_floor',
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: { zip: '80202', city: 'Denver', state: 'CO', lat: 39.7, lng: -104.9 },
    dealer: { name: 'Primary Mobility', phone: '303-555-0101', website: null },
    images: [],
    description: null,
    listedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    provenance: {
      sourceName: 'Primary Source',
      sourceBaseUrl: 'https://dealer.example.com',
      sourceUrl: 'https://dealer.example.com/listing/1',
      buyerUrl: null,
      scrapedAt: '2026-01-02T00:00:00.000Z',
      detailScrapedAt: '2026-01-02T00:00:00.000Z',
      vehicleModelMatchConfidence: null,
    },
    crossListings: [],
    ...overrides,
  }
}

describe('OverviewTab cross-listings', () => {
  it('renders alternate dealer cards with listing-specific links', () => {
    render(
      <OverviewTab
        listing={makeListing({
          crossListings: [
            {
              id: 'listing-2',
              sourceUrl: 'https://dealer-two.example.com/listing/2',
              buyerUrl: 'https://dealer-two.example.com/buy/2',
              sellerType: 'dealer',
              priceCents: 3600000,
              location: { zip: '78701', city: 'Austin', state: 'TX' },
              dealer: { name: 'Austin Mobility', phone: '512-555-0100', website: null },
            },
          ],
        })}
        priceHistory={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Also available at' })).toBeTruthy()
    expect(screen.getByText('Austin Mobility')).toBeTruthy()
    const alternateLink = screen.getAllByRole('link', { name: /View listing/ })
      .find((link) => link.getAttribute('href') === 'https://dealer-two.example.com/buy/2')
    expect(alternateLink).toBeTruthy()
  })
})
