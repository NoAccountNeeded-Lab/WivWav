// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavRail } from './NavRail'

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NavRail', () => {
  it('renders every primary-placement destination as an icon link', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<NavRail />)

    expect(screen.getByRole('link', { name: /Operations overview/ })).toBeDefined()
    expect(screen.getByRole('link', { name: /Source health/ })).toBeDefined()
  })

  it('marks the active route with aria-current="page" and a visible active state', () => {
    usePathnameMock.mockReturnValue('/ops/sources')
    render(<NavRail />)

    const activeLink = screen.getByRole('link', { name: /Source health/ })
    expect(activeLink.getAttribute('aria-current')).toBe('page')
    expect(activeLink.getAttribute('data-active')).toBe('true')

    const inactiveLink = screen.getByRole('link', { name: /Operations overview/ })
    expect(inactiveLink.getAttribute('aria-current')).toBeNull()
  })

  it('renders a "More" trigger that toggles aria-expanded', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<NavRail />)

    const moreButton = screen.getByRole('button', { name: 'More' })
    expect(moreButton.getAttribute('aria-haspopup')).toBe('dialog')
    expect(moreButton.getAttribute('aria-expanded')).toBe('false')
  })
})
