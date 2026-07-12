// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InspectorPanel } from './InspectorPanel'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InspectorPanel', () => {
  it('renders nothing when closed', () => {
    render(
      <InspectorPanel isOpen={false} title="Job details" onClose={vi.fn()}>
        <p>Body</p>
      </InspectorPanel>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders as a labeled dialog with the supplied content when open', () => {
    render(
      <InspectorPanel isOpen title="Job details" onClose={vi.fn()}>
        <p>Job payload here</p>
      </InspectorPanel>,
    )

    expect(screen.getByRole('dialog', { name: 'Job details' })).toBeDefined()
    expect(screen.getByText('Job payload here')).toBeDefined()
  })

  it('focuses the close button on open', () => {
    render(
      <InspectorPanel isOpen title="Job details" onClose={vi.fn()}>
        <p>Body</p>
      </InspectorPanel>,
    )

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <InspectorPanel isOpen title="Job details" onClose={onClose}>
        <p>Body</p>
      </InspectorPanel>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the close button or the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <InspectorPanel isOpen title="Job details" onClose={onClose}>
        <p>Body</p>
      </InspectorPanel>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Job details' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('returns focus to whatever was focused before the panel opened', () => {
    function Harness() {
      const [isOpen, setIsOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>
            Open
          </button>
          <InspectorPanel isOpen={isOpen} title="Job details" onClose={() => setIsOpen(false)}>
            <p>Body</p>
          </InspectorPanel>
        </>
      )
    }

    render(<Harness />)
    const openButton = screen.getByRole('button', { name: 'Open' })
    openButton.focus()
    fireEvent.click(openButton)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.activeElement).toBe(openButton)
  })
})
