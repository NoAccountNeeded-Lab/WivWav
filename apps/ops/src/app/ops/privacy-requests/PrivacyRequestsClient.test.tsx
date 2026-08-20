// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrivacyRequestsClient } from './PrivacyRequestsClient'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('PrivacyRequestsClient deletion request', () => {
  it('should submit a deletion request and show the applied outcome', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { listingId: 'listing-1', outcome: 'applied', fieldsCleared: ['description'], imagesDeleted: 2, rawPagesDeleted: 1 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<PrivacyRequestsClient apiBaseUrl="http://api.test" />)

    fireEvent.change(screen.getAllByPlaceholderText('clxxxxxxxxxxxxxxxxxxxxxxxx')[0]!, {
      target: { value: 'listing-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /delete private-seller data/i }))

    await screen.findByText(/sensitive fields cleared/i)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/admin/private-seller-retention/listings/listing-1/delete',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('should show an error message without crashing when the listing is not a private seller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'NOT_PRIVATE_SELLER', message: 'Not a private seller listing' } }, 422)),
    )

    render(<PrivacyRequestsClient apiBaseUrl="http://api.test" />)

    fireEvent.change(screen.getAllByPlaceholderText('clxxxxxxxxxxxxxxxxxxxxxxxx')[0]!, { target: { value: 'listing-2' } })
    fireEvent.click(screen.getByRole('button', { name: /delete private-seller data/i }))

    await screen.findByText('Not a private seller listing')
  })

  it('should refuse to submit without a listing ID', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<PrivacyRequestsClient apiBaseUrl="http://api.test" />)

    fireEvent.click(screen.getByRole('button', { name: /delete private-seller data/i }))

    await screen.findByText('Enter a listing ID before submitting.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PrivacyRequestsClient deletion history', () => {
  it('should look up and render audit entries for a listing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              listingId: 'listing-1',
              action: 'automated-retention',
              outcome: 'applied',
              fieldsCleared: ['description', 'zip'],
              reason: null,
              requestedBy: null,
              errorMessage: null,
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    )

    render(<PrivacyRequestsClient apiBaseUrl="http://api.test" />)

    const historyInputs = screen.getAllByPlaceholderText('clxxxxxxxxxxxxxxxxxxxxxxxx')
    fireEvent.change(historyInputs[historyInputs.length - 1]!, { target: { value: 'listing-1' } })
    fireEvent.click(screen.getByRole('button', { name: /look up history/i }))

    await screen.findByText('description, zip')
    expect(screen.getByText('applied')).toBeTruthy()
  })

  it('should show an empty-state message when no history exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))

    render(<PrivacyRequestsClient apiBaseUrl="http://api.test" />)

    const historyInputs = screen.getAllByPlaceholderText('clxxxxxxxxxxxxxxxxxxxxxxxx')
    fireEvent.change(historyInputs[historyInputs.length - 1]!, { target: { value: 'listing-3' } })
    fireEvent.click(screen.getByRole('button', { name: /look up history/i }))

    await screen.findByText(/no deletion-lifecycle activity recorded/i)
  })
})
