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

  it('locks body scroll while open, matching the MoreSheet modal contract, and releases it on close', () => {
    const { rerender } = render(
      <InspectorPanel isOpen title="Job details" onClose={vi.fn()}>
        <p>Body</p>
      </InspectorPanel>,
    )

    expect(document.body.style.overflow).toBe('hidden')

    rerender(
      <InspectorPanel isOpen={false} title="Job details" onClose={vi.fn()}>
        <p>Body</p>
      </InspectorPanel>,
    )

    expect(document.body.style.overflow).toBe('')
  })

  it('does not re-run open setup (re-focus the close button) when onClose identity changes while open (unrelated param churn)', () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')

    function Harness() {
      const [, forceRerender] = useState(0)
      // A fresh closure every render, mirroring `useInspectorParam().close`
      // changing identity whenever unrelated search params change.
      const onClose = () => {}
      return (
        <>
          <button type="button" onClick={() => forceRerender(n => n + 1)}>
            Trigger unrelated update
          </button>
          <InspectorPanel isOpen title="Job details" onClose={onClose}>
            <p>Body</p>
          </InspectorPanel>
        </>
      )
    }

    render(<Harness />)
    const closeButtonFocusCallsAfterOpen = focusSpy.mock.calls.length
    expect(closeButtonFocusCallsAfterOpen).toBeGreaterThan(0)
    focusSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Trigger unrelated update' }))

    // If the effect were keyed on `onClose` identity, this re-render would
    // re-run setup and call `.focus()` again to steal focus back onto the
    // close button.
    expect(focusSpy).not.toHaveBeenCalled()

    focusSpy.mockRestore()
  })
})
