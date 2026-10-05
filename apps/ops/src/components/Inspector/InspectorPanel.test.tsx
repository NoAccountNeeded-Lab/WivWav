// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InspectorPanel } from './InspectorPanel'
import { InspectorPortal } from './InspectorPortal'
import { OPS_INSPECTOR_SLOT_ID } from './inspector-slot'

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

// #1077: jsdom cannot resolve media queries, so assert the two layout modes
// against the stylesheet source (same tripwire approach as OpsShell.test.ts).
describe('InspectorPanel layout modes (#1077)', () => {
  const css = readFileSync(path.join(import.meta.dirname, 'InspectorPanel.module.css'), 'utf8')
  const base = css.split('@media')[0] ?? ''
  const wide = css.match(/@media \(min-width: 80rem\)\s*\{([\s\S]*)\}\s*$/)?.[1] ?? ''

  it('renders as a fixed full-viewport overlay below 80rem', () => {
    const backdrop = base.match(/\.backdrop\s*\{[^}]*\}/)?.[0] ?? ''
    expect(backdrop).toMatch(/position:\s*fixed/)
    expect(backdrop).toMatch(/inset:\s*0/)
  })

  it('docks as a sticky, viewport-height column at and above 80rem so actions stay visible after scrolling', () => {
    const backdrop = wide.match(/\.backdrop\s*\{[^}]*\}/)?.[0] ?? ''
    expect(backdrop).toMatch(/position:\s*sticky/)
    expect(backdrop).toMatch(/height:\s*calc\(100dvh/)
  })
})

describe('InspectorPanel inside the OpsShell inspector slot (#1077)', () => {
  it('renders as a sibling of the placeholder inside the slot', () => {
    const slot = document.createElement('div')
    slot.id = OPS_INSPECTOR_SLOT_ID
    const placeholder = document.createElement('div')
    placeholder.setAttribute('aria-hidden', 'true')
    slot.appendChild(placeholder)
    document.body.appendChild(slot)

    render(
      <InspectorPortal>
        <InspectorPanel isOpen title="Run" onClose={vi.fn()}>
          <p>Body</p>
        </InspectorPanel>
      </InspectorPortal>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Run' })
    expect(slot.contains(dialog)).toBe(true)
    expect(slot.children.length).toBe(2)
    slot.remove()
  })
})
