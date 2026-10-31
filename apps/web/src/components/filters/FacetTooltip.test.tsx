// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FacetTooltip } from './FacetTooltip'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('FacetTooltip', () => {
  it('shows on keyboard focus immediately, links the trigger, and dismisses with Escape', () => {
    render(<FacetTooltip text="Ford: 12"><button type="button">Ford</button></FacetTooltip>)
    const trigger = screen.getByRole('button', { name: 'Ford' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip').textContent).toBe('Ford: 12')
    expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)

    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('waits about 150 ms on hover and hides on leave', () => {
    vi.useFakeTimers()
    const { container } = render(<FacetTooltip text="Ford: 12"><button type="button">Ford</button></FacetTooltip>)
    const wrap = container.firstElementChild as HTMLElement
    fireEvent.mouseEnter(wrap)
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(60) })
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(wrap)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
