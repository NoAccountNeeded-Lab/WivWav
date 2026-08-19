// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavigationFocusReset } from './NavigationFocusReset'

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }))

vi.mock('next/navigation', () => ({ usePathname }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  usePathname.mockReturnValue('/listings')
  document.body.innerHTML = '<main id="main-content"><h1>Listings</h1></main>'
})

describe('NavigationFocusReset', () => {
  it('does not focus the primary heading on initial mount', () => {
    const heading = document.querySelector('h1')!
    const focus = vi.spyOn(heading, 'focus')

    render(<NavigationFocusReset />)

    expect(focus).not.toHaveBeenCalled()
  })

  it('focuses the primary heading without scrolling after a pathname change', () => {
    const heading = document.querySelector('h1')!
    const focus = vi.spyOn(heading, 'focus')
    const view = render(<NavigationFocusReset />)
    usePathname.mockReturnValue('/listings?page=2')

    view.rerender(<NavigationFocusReset />)

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(heading.getAttribute('tabindex')).toBe('-1')
  })

  it('does not perform another reset when the pathname is unchanged', () => {
    const heading = document.querySelector('h1')!
    const focus = vi.spyOn(heading, 'focus')
    const view = render(<NavigationFocusReset />)

    view.rerender(<NavigationFocusReset />)

    expect(focus).not.toHaveBeenCalled()
  })
})
