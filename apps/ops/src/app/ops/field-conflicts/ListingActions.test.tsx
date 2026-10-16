// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListingActions } from './ListingActions'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ListingActions', () => {
  it('confirms in page before calling the API, and requires a reason to hide', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { message: 'Hidden', jobId: null } }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<ListingActions listingId="l1" apiBaseUrl="" />)

    fireEvent.click(screen.getByRole('button', { name: 'Hide from public' }))
    expect(fetchMock).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'wrong van' } })
    fireEvent.click(confirm)

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Hidden'))
    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(call[0]).toBe('/internal/ops/listings/l1/actions')
    expect(JSON.parse(call[1].body)).toEqual({ action: 'hide', reason: 'wrong van' })
  })

  it('shows API conflicts as an alert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: { message: 'Listing is gone' } }) }) as Response))
    render(<ListingActions listingId="l1" apiBaseUrl="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-run validation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Listing is gone')
  })

  it('moves focus into the confirm, and returns it to the opening control on Escape and after confirming', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { message: 'Done', jobId: '9' } }) }) as Response))
    render(<ListingActions listingId="l1" apiBaseUrl="" />)
    const opener = screen.getByRole('button', { name: 'Mark as gone' })

    opener.focus()
    fireEvent.click(opener)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))
    fireEvent.keyDown(cancel, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('job 9'))
    expect(document.activeElement).toBe(opener)
  })

  it('has no VIN decode action', () => {
    render(<ListingActions listingId="l1" apiBaseUrl="" />)
    expect(screen.queryByRole('button', { name: /VIN/ })).toBeNull()
  })
})
