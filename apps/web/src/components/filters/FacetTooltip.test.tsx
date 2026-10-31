// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FacetTooltip } from './FacetTooltip'

const realMatches = Element.prototype.matches
/** jsdom has no focus-visible heuristics, so tests choose the answer. */
function focusVisible(value: boolean) {
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? value : realMatches.call(this, selector)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
  vi.useRealTimers()
})

describe('FacetTooltip', () => {
  it('shows on keyboard focus immediately, links the trigger, and dismisses with Escape', () => {
    render(<FacetTooltip text="Ford: 12"><button type="button">Ford</button></FacetTooltip>)
    const trigger = screen.getByRole('button', { name: 'Ford' })
    expect(document.querySelector('[data-tooltip]')).toBeNull()

    focusVisible(true)
    fireEvent.focus(trigger)
    expect(document.querySelector('[data-tooltip]')!.textContent).toBe('Ford: 12')
    // Duplicates the trigger's own name, so it is hidden from assistive technology and not described-by.
    expect(document.querySelector('[data-tooltip]')!.getAttribute('aria-hidden')).toBe('true')
    expect(trigger.hasAttribute('aria-describedby')).toBe(false)

    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(document.querySelector('[data-tooltip]')).toBeNull()
  })

  it('waits about 150 ms on hover and hides on leave', () => {
    vi.useFakeTimers()
    const { container } = render(<FacetTooltip text="Ford: 12"><button type="button">Ford</button></FacetTooltip>)
    const wrap = container.firstElementChild as HTMLElement
    fireEvent.mouseEnter(wrap)
    act(() => { vi.advanceTimersByTime(100) })
    expect(document.querySelector('[data-tooltip]')).toBeNull()
    act(() => { vi.advanceTimersByTime(60) })
    expect(document.querySelector('[data-tooltip]')!).toBeTruthy()
    fireEvent.mouseLeave(wrap)
    expect(document.querySelector('[data-tooltip]')).toBeNull()
  })

  it('stays closed when focus is not keyboard-driven (:focus-visible does not match)', () => {
    focusVisible(false)
    render(<FacetTooltip text="Ford: 12"><button type="button">Ford</button></FacetTooltip>)
    fireEvent.focus(screen.getByRole('button', { name: 'Ford' }))
    expect(document.querySelector('[data-tooltip]')).toBeNull()
  })
})
