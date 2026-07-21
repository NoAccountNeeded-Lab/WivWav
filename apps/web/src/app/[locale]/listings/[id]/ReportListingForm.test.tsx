// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverviewTab } from './OverviewTab'
import { ReportListingForm } from './ReportListingForm'
import type { ListingDetail } from './types'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderOpenForm(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  render(<ReportListingForm listingId="listing-1" apiBaseUrl="https://api.example.com" />)
  fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }))
}

function makeListing(overrides: Partial<ListingDetail> = {}): ListingDetail {
  return {
    id: 'listing-1',
    sourceUrl: 'https://dealer.example/listing-1',
    buyerUrl: null,
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    trim: null,
    vin: null,
    condition: 'used',
    sellerType: 'dealer',
    priceCents: 3500000,
    mileage: null,
    color: null,
    fuelType: null,
    engine: null,
    transmission: null,
    stockNumber: null,
    wav: {
      conversionType: 'unknown',
      conversionManufacturer: null,
      floorLoweringInches: null,
      rampType: 'unknown',
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: { zip: null, city: null, state: null, lat: null, lng: null },
    dealer: { name: null, phone: null, website: null },
    images: [],
    description: null,
    listedAt: '2026-07-01T00:00:00.000Z',
    sourceListedAt: null,
    sourceUpdatedAt: null,
    updatedAt: '2026-07-02T00:00:00.000Z',
    provenance: null,
    crossListings: [],
    ...overrides,
  }
}

describe('ReportListingForm', () => {
  it('submits a one-click availability report', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ReportListingForm listingId="listing-1" apiBaseUrl="https://api.example.com" />)

    fireEvent.click(screen.getByRole('button', { name: 'Is this listing still available?' }))

    await screen.findByRole('status')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/listings/listing-1/reports',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reportType: 'sold_or_stale',
          notes: 'Buyer asked whether this listing is still available.',
        }),
      }),
    )
    expect(screen.getByText('Thanks. We flagged this listing for availability review.')).toBeTruthy()
  })

  it('submits a valid report and shows a success state', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    renderOpenForm(fetchMock)

    fireEvent.change(screen.getByLabelText('What looks wrong?'), { target: { value: 'specs_incorrect' } })
    fireEvent.change(screen.getByLabelText('Notes, optional'), { target: { value: 'Ramp type looks wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))

    await screen.findByRole('status')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/listings/listing-1/reports',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reportType: 'specs_incorrect', notes: 'Ramp type looks wrong' }),
      }),
    )
    expect(screen.getByText('Thanks. We recorded this report for review.')).toBeTruthy()
  })

  it('shows validation feedback without calling the API when report type is missing', async () => {
    const fetchMock = vi.fn()
    renderOpenForm(fetchMock)

    fireEvent.submit(screen.getByRole('button', { name: 'Submit report' }).closest('form')!)

    expect((await screen.findByRole('alert')).textContent).toBe('Choose what looks wrong before submitting.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows an error state when the API rejects the report', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }))
    renderOpenForm(fetchMock)

    fireEvent.change(screen.getByLabelText('What looks wrong?'), { target: { value: 'duplicate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))

    expect((await screen.findByRole('alert')).textContent).toBe('We could not submit the report. Try again in a moment.')
  })

  it('prevents duplicate rapid submissions while a report is pending', async () => {
    let resolveFetch: (value: { ok: boolean }) => void = () => {}
    const fetchMock = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => {
      resolveFetch = resolve
    }))
    renderOpenForm(fetchMock)

    fireEvent.change(screen.getByLabelText('What looks wrong?'), { target: { value: 'other' } })
    const submit = screen.getByRole('button', { name: 'Submit report' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(true))
    resolveFetch({ ok: true })
    await screen.findByRole('status')
  })
})

describe('OverviewTab report warning badge', () => {
  it('shows a data accuracy warning when unresolved reports meet the threshold', () => {
    render(
      <OverviewTab
        listing={makeListing({ reportSummary: { unresolvedCount: 3, flagged: true } })}
        priceHistory={[]}
        apiBaseUrl="https://api.example.com"
      />,
    )

    expect(screen.getByRole('note', { name: 'Data accuracy warning' }).textContent).toBe('Data accuracy flagged by users')
  })
})

describe('OverviewTab listing date provenance', () => {
  it('shows relative verification age and stale dealer warning', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T15:00:00.000Z'))

    render(
      <OverviewTab
        listing={makeListing({
          provenance: {
            sourceName: 'Example Dealer',
            sourceBaseUrl: 'https://dealer.example',
            sourceUrl: 'https://dealer.example/listing-1',
            buyerUrl: null,
            scrapedAt: '2026-07-01T00:00:00.000Z',
            detailScrapedAt: null,
            vehicleModelMatchConfidence: null,
          },
        })}
        priceHistory={[]}
        apiBaseUrl="https://api.example.com"
      />,
    )

    expect(screen.getByRole('note', { name: 'Listing verification status' }).textContent).toContain(
      'Last verified 15 hours ago',
    )
    expect(screen.getByText(/This listing may no longer be available/).textContent).toContain(
      'verify with the dealer',
    )

    vi.useRealTimers()
  })

  it('labels seller/source dates separately from the discovery date', () => {
    render(
      <OverviewTab
        listing={makeListing({
          listedAt: '2026-05-05T12:00:00.000Z',
          sourceListedAt: '2026-05-01T12:00:00.000Z',
          sourceUpdatedAt: '2026-05-03T12:00:00.000Z',
          provenance: {
            sourceName: 'Example Dealer',
            sourceBaseUrl: 'https://dealer.example',
            sourceUrl: 'https://dealer.example/listing-1',
            buyerUrl: null,
            scrapedAt: '2026-05-05T12:00:00.000Z',
            detailScrapedAt: '2026-05-06T12:00:00.000Z',
            vehicleModelMatchConfidence: null,
          },
        })}
        priceHistory={[]}
        apiBaseUrl="https://api.example.com"
      />,
    )

    expect(screen.getByText(/Source listed May 1, 2026/).textContent).toContain(
      'Source updated May 3, 2026',
    )
    // "Last checked"/detailScrapedAt is not repeated here — it's already
    // shown once, up top, as "Last verified" (see the verification banner).
    const footerText = screen.getByText(/First saw/).textContent
    expect(footerText).toContain('First saw May 5, 2026')
    expect(footerText).not.toContain('Last checked')
  })

  it('labels listedAt as the first-seen date when source dates are unavailable', () => {
    render(
      <OverviewTab
        listing={makeListing({ listedAt: '2026-05-05T12:00:00.000Z' })}
        priceHistory={[]}
        apiBaseUrl="https://api.example.com"
      />,
    )

    expect(screen.getByText('First saw May 5, 2026')).toBeTruthy()
    expect(screen.queryByText(/Source listed/)).toBeNull()
  })
})
