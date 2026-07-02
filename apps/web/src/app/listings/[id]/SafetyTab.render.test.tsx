// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SafetyTab } from './SafetyTab'
import type { ListingDetail, SafetyData } from './types'

afterEach(() => cleanup())

const listing: ListingDetail = {
  id: 'listing-1',
  sourceUrl: 'https://dealer.example.com/listing/1',
  buyerUrl: null,
  make: 'Toyota',
  model: 'Sienna',
  year: 2022,
  trim: null,
  vin: null,
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
  location: { zip: null, city: null, state: null, lat: null, lng: null },
  dealer: { name: null, phone: null, website: null },
  images: [],
  description: null,
  listedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  provenance: null,
  crossListings: [],
}

function makeSafety(crashInvolved: boolean): SafetyData {
  return {
    vehicleModel: {
      id: 'model-1',
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      trim: null,
      bodyType: 'Minivan',
    },
    recalls: [],
    complaints: [
      {
        id: 'complaint-1',
        nhtsaId: '123456',
        component: 'STEERING',
        summary: 'Steering complaint',
        mileage: 42000,
        crashInvolved,
        reportedAt: '2026-05-10T12:00:00.000Z',
      },
    ],
    safetyRatings: [],
    safetyFreshnessDate: '2099-01-01T00:00:00.000Z',
    investigations: [],
    manufacturerCommunications: [],
  }
}

describe('SafetyTab complaint details', () => {
  it('renders the complaint date and crash involvement as text', () => {
    render(<SafetyTab listing={listing} safety={makeSafety(true)} apiBaseUrl="" />)

    const complaints = screen.getByRole('list', { name: 'NHTSA complaints' })
    expect(within(complaints).getByText(/Reported May 10, 2026/)).toBeTruthy()
    expect(within(complaints).getByText('Crash involved')).toBeTruthy()
  })

  it('explicitly identifies complaints with no reported crash', () => {
    render(<SafetyTab listing={listing} safety={makeSafety(false)} apiBaseUrl="" />)

    expect(screen.getByText('No crash reported')).toBeTruthy()
  })
})
