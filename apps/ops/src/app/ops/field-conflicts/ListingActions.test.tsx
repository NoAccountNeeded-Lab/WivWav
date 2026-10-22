// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    render(<ListingActions listingId="l1" manuallyHiddenAt={null} apiBaseUrl="" />)

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
    render(<ListingActions listingId="l1" manuallyHiddenAt={null} apiBaseUrl="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-run validation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Listing is gone')
  })

  it('moves focus into the confirm, and returns it to the opening control on Escape and after confirming', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { message: 'Done', jobId: '9' } }) }) as Response))
    render(<ListingActions listingId="l1" manuallyHiddenAt={null} apiBaseUrl="" />)
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

  it('keeps confirm focus and Escape return inside the instance that opened it when a listing repeats', async () => {
    render(
      <>
        <section data-testid="row-a"><ListingActions listingId="l1" manuallyHiddenAt={null} apiBaseUrl="" /></section>
        <section data-testid="row-b"><ListingActions listingId="l1" manuallyHiddenAt={null} apiBaseUrl="" /></section>
      </>,
    )
    const rowB = within(screen.getByTestId('row-b'))
    const opener = rowB.getByRole('button', { name: 'Mark as gone' })
    fireEvent.click(opener)
    const cancel = rowB.getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))
    fireEvent.keyDown(cancel, { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
  })

  it('sends the hide timestamp the operator saw with unhide', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { message: 'Unhidden', jobId: null } }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<ListingActions listingId="l1" manuallyHiddenAt="2026-10-01T00:00:00.000Z" apiBaseUrl="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore hidden listing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(JSON.parse(call[1].body)).toEqual({ action: 'unhide', manuallyHiddenAt: '2026-10-01T00:00:00.000Z' })
  })

  it('has no VIN decode action', () => {
    render(<ListingActions listingId="l1" manuallyHiddenAt={null} apiBaseUrl="" />)
    expect(screen.queryByRole('button', { name: /VIN/ })).toBeNull()
  })
})
