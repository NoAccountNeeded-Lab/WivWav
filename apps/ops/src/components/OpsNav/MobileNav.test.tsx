// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNav } from './MobileNav'

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MobileNav', () => {
  it('opens the More sheet with the full registry when the More tab is activated', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<MobileNav />)

    fireEvent.click(screen.getByRole('button', { name: /More/ }))

    expect(screen.getByRole('dialog', { name: 'More navigation' })).toBeDefined()
    // Advanced-only destinations (not in the bottom tab set) are reachable here.
    expect(screen.getByRole('link', { name: /AI provider settings/ })).toBeDefined()
  })

  it('closes the sheet and returns focus to the More tab on Escape', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<MobileNav />)

    const moreButton = screen.getByRole('button', { name: /More/ })
    fireEvent.click(moreButton)
    expect(screen.getByRole('dialog', { name: 'More navigation' })).toBeDefined()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'More navigation' })).toBeNull()
    expect(document.activeElement).toBe(moreButton)
  })

  it('closes the sheet and returns focus to the More tab when a destination is selected', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<MobileNav />)

    const moreButton = screen.getByRole('button', { name: /More/ })
    fireEvent.click(moreButton)

    fireEvent.click(screen.getByRole('link', { name: /AI provider settings/ }))

    expect(screen.queryByRole('dialog', { name: 'More navigation' })).toBeNull()
    expect(document.activeElement).toBe(moreButton)
  })

  it('closes the sheet when its own close button is clicked', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<MobileNav />)

    const moreButton = screen.getByRole('button', { name: /More/ })
    fireEvent.click(moreButton)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog', { name: 'More navigation' })).toBeNull()
    expect(document.activeElement).toBe(moreButton)
  })
})
