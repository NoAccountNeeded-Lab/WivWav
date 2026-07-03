// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilterGroup } from './FilterGroup'
import type { FilterItem } from './types'

function makeItems(count: number): FilterItem[] {
  return Array.from({ length: count }, (_, i) => ({
    value: `item-${i}`,
    label: `Item ${i}`,
    count: count - i,
    active: false,
    disabled: false,
  }))
}

afterEach(() => {
  cleanup()
})

describe('FilterGroup', () => {
  it('should render only maxVisible items when collapsed', async () => {
    render(
      <FilterGroup title="Make" labelId="make" items={makeItems(12)} onToggle={vi.fn()} maxVisible={8} />,
    )
    const buttons = await screen.findAllByRole('button', { name: /^Item \d+/ })
    expect(buttons).toHaveLength(8)
  })

  it('should show a "Show N more" button when items exceed maxVisible', async () => {
    render(
      <FilterGroup title="Make" labelId="make" items={makeItems(12)} onToggle={vi.fn()} maxVisible={8} />,
    )
    expect(await screen.findByRole('button', { name: 'Show 4 more' })).toBeDefined()
  })

  it('should not show a "Show more" button when items fit within maxVisible', async () => {
    render(
      <FilterGroup title="Make" labelId="make" items={makeItems(5)} onToggle={vi.fn()} maxVisible={8} />,
    )
    await screen.findAllByRole('button', { name: /^Item \d+/ })
    expect(screen.queryByRole('button', { name: /Show.*more/ })).toBeNull()
  })

  it('should open a dialog with the full item list when "Show more" is clicked', async () => {
    render(
      <FilterGroup title="Make" labelId="make" items={makeItems(12)} onToggle={vi.fn()} maxVisible={8} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Show 4 more' }))

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.querySelectorAll('[aria-pressed]')).toHaveLength(12))
  })

  it('should not shift the collapsed list when the modal is open', async () => {
    render(
      <FilterGroup title="Make" labelId="make" items={makeItems(12)} onToggle={vi.fn()} maxVisible={8} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Show 4 more' }))

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.querySelectorAll('[aria-pressed]')).toHaveLength(12))

    // The collapsed renderer still shows only 8 items; the dialog renders
    // its own separate copy of the full 12-item list.
    const allPressed = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
    expect(allPressed).toHaveLength(8 + 12)
  })

  it('should close the dialog when the close button is clicked', async () => {
    render(
      <FilterGroup title="Make" labelId="make" items={makeItems(12)} onToggle={vi.fn()} maxVisible={8} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Show 4 more' }))
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('should close the dialog when the backdrop is clicked', async () => {
    render(
      <FilterGroup title="Make" labelId="make" items={makeItems(12)} onToggle={vi.fn()} maxVisible={8} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Show 4 more' }))
    const dialog = await screen.findByRole('dialog')

    const backdrop = dialog.parentElement as HTMLElement
    fireEvent.mouseDown(backdrop)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('should not close the dialog when clicking inside the panel', async () => {
    render(
      <FilterGroup title="Make" labelId="make" items={makeItems(12)} onToggle={vi.fn()} maxVisible={8} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Show 4 more' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.mouseDown(dialog)
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('should close the dialog when Escape is pressed', async () => {
    render(
      <FilterGroup title="Make" labelId="make" items={makeItems(12)} onToggle={vi.fn()} maxVisible={8} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Show 4 more' }))
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
