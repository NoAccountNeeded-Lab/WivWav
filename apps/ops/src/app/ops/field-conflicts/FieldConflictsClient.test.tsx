// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FieldConflictsClient } from './FieldConflictsClient'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ROW = {
  listingId: 'listing-1',
  sourceUrl: 'https://dealer.example.com/listing/1',
  make: 'Toyota',
  model: 'Sienna',
  year: 2022,
  field: 'conversionType',
  competingValues: ['side_entry', 'rear_entry'],
  evidenceKinds: ['structured_source', 'vehicle_text'],
  sourceRefs: ['https://dealer.example.com/listing/1', 'https://dealer.example.com/listing/1/detail'],
  observedAts: ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
  detectedAt: '2026-01-02T00:00:00.000Z',
}

describe('FieldConflictsClient', () => {
  it('renders unresolved field conflicts with competing values and a source link', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/admin/field-conflicts')) {
        return jsonResponse({ data: [ROW], meta: { total: 1, skip: 0, take: 50 } })
      }
      throw new Error(`Unexpected URL in test: ${url}`)
    }))

    render(<FieldConflictsClient apiBaseUrl="" />)

    expect(await screen.findByText('2022 Toyota Sienna')).toBeTruthy()
    expect(screen.getByText('side_entry')).toBeTruthy()
    expect(screen.getByText('rear_entry')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'View listing' })
    expect(link.getAttribute('href')).toBe('https://dealer.example.com/listing/1')
  })

  it('shows an empty state when there are no unresolved conflicts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [], meta: { total: 0, skip: 0, take: 50 } })))

    render(<FieldConflictsClient apiBaseUrl="" />)

    expect(await screen.findByText(/No unresolved field conflicts/i)).toBeTruthy()
  })

  it('shows an error state when the API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response))

    render(<FieldConflictsClient apiBaseUrl="" />)

    await waitFor(() => {
      expect(screen.getByText(/Field conflicts could not load/i)).toBeTruthy()
    })
  })
})
