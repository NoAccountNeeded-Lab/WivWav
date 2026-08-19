// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { FacetModal } from './FacetModal'

afterEach(() => {
  cleanup()
})

function ModalFixture() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open facets</button>
      {open ? (
        <FacetModal title="Vehicle type" onClose={() => setOpen(false)}>
          <button type="button">First option</button>
          <button type="button">Last option</button>
        </FacetModal>
      ) : null}
    </>
  )
}

function openModal() {
  render(<ModalFixture />)
  const trigger = screen.getByRole('button', { name: 'Open facets' })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

describe('FacetModal', () => {
  it('moves initial focus to its close button', () => {
    openModal()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('contains Tab and Shift+Tab focus within the dialog', () => {
    openModal()
    const close = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('button', { name: 'Last option' })

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('dismisses on Escape and restores focus to its trigger', () => {
    const trigger = openModal()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
